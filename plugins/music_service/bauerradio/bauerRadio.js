'use strict';
var unirest=require('unirest');
var libQ=require('kew');

const premiumStreamBase = 'https://stream.on.revma.com';
const NowPlayingPremiumUrl = new URL('https://stream.on.revma.com/api/user/command/now_playing');
const NowPlayingUrl = 'https://listenapi.planetradio.co.uk/api9.2/nowplaying';

const stations = new Map();
const brands = new Map();
let lastBrandsUpdate = -1;

let premiumUser = true;
let preferACC = true;
let uid = '';
let currentPlayingURL = '';
let realTimeNowPlaying = '';
let currentNowPlaying = '';

//premiumUser = false;
// ======================= START OF MODULE EXPORT
module.exports = {
// ======================= Tools (called from outside)

    // Get a map of BauerRadio live stations
    getLiveStations: function () {
    //function getLiveStations (){
        var defer=libQ.defer();
        
        if (stations.size> 0) {
            defer.resolve(stations);
            console.log('Returned existing map');
        }
        else {
            let premium = "";
            if (premiumUser) premium = "?premium=1"
        
            console.log('Requesting info through web. Include premium stations: ' + premiumUser);
            unirest
                .get(`https://listenapi.planetradio.co.uk/api9.2/stations/gb${premium}`)
                .then((response) => {
                    if (response &&
                        response.status === 200) {
    //                    const stations = new Map();
                        for (var station in response.body) {
            //                    console.log(station);
                            let brandID = response.body[station]['stationBrandCode'];
                            stations.set(response.body[station]['stationCode'], {
                                "lastDetailsUpdate": -1,
                                "name": response.body[station]['stationName'],
                                "albumart": response.body[station]['stationListenBarLogo'],
                                "brand": brandID,
                                "premiumOnlyStation": response.body[station]['premiumOnlyStation']
                            });
                            var brand;
                            if (brands.has(brandID)){
                                brand = brands.get(brandID);
                                brand["stations"].push(response.body[station]['stationCode']);
                            } else {
                                brand =  {
                                    "name": brandID,
                                    "albumart": response.body[station]['stationListenBarLogo'],
                                    "stations": [response.body[station]['stationCode']]
                                }
                            }
                            brands.set(brandID, brand)
                        }
        //                console.log(response.body[28]);
        //                console.log(stations.get('jaz'))  
                        defer.resolve(stations);
                    } else {
                        defer.reject();
                    }
                });
        }
        return defer.promise;
    },

    // Get a details for selected station
    getStationDetails: function (key) {

        var defer=libQ.defer();

        if (stations.has(key) && stations.get(key)["lastDetailsUpdate"] > 0) {
            console.log('No need to fetch details');
            defer.resolve(stations.get(key));
        } else {
            console.log('Fetching details. Station in map: ', stations.has(key));
            unirest
                .get(`https://listenapi.planetradio.co.uk/api9.2/initweb/${key}`)
                .then((response) => {
                    if (response && response.status === 200) {
                        let stationDetails = {
                            "lastDetailsUpdate": Date.now(),
                            "name": response.body['stationName'],
                            "albumart": response.body['stationListenBarLogo'],
                            "brand": response.body['stationBrandCode'],
                            "premiumOnlyStation": response.body['premiumOnlyStation'],
                            "premiumEnabled": response.body['premiumEnabled'],
                            "streamACC": response.body['stationAACStream'],
                            "streamMP3": response.body['stationMP3Stream'],
                            "streamPremiumACC": "",
                            "streamPremiumMP3": ""
                        };
//                        console.log(response.body['premiumEnabled']);
                        if (response.body['premiumEnabled'] || response.body['premiumOnlyStation']){
                            response.body['stationStreams'].forEach((stream) => {
    //                            console.log(stream);
                                if (stream['streamPremium']) {
                                    if (stream['streamQuality'] === "hq") {
                                        if (response.body['premiumOnlyStation'] || stream['streamType'] === 'adts')
                                            stationDetails['streamPremiumACC'] = stream['streamUrl'];
                                        else
                                            stationDetails['streamPremiumMP3'] = stream['streamUrl'];
                                    }
                                }
                            });
                        } 
                        stations.set(key, stationDetails);
        //                console.log(response.body[28]);
        //                console.log(stations.get('jaz'))  
                        defer.resolve(stationDetails);
                    } else {
                        defer.reject();
                    }
                });
        };
        return defer.promise;
    },
    
    // Get list of available brands
    getBrands: function () {

        var defer=libQ.defer();

        if (lastBrandsUpdate > 0) {
            console.log('No need to fetch brand details');
            defer.resolve(brands);
        } else {
            console.log('Fetching details. Brands in map: ', brands.size);
            unirest
                .get(`https://listenapi.planetradio.co.uk/api9.2/brands`)
                .then((response) => {
                    if (response && response.status === 200) {
                        response.body.forEach((brand) => {
                            let brandID = brand["BrandCode"];
                            if (brands.has(brandID)) {
                                let updatedBrand = brands.get(brandID);
                                updatedBrand["name"] = brand['BrandName'];
                                updatedBrand["albumart"] = brand['BrandWhiteLogoImageUrl'];
                                brands.set(brandID, updatedBrand);
                            }
                        });
        //                console.log(response.body[28]);
        //                console.log(stations.get('jaz'))  
                        lastBrandsUpdate = Date.now();
                        defer.resolve(brands);
                    } else {
                        defer.reject();
                    }
                });
        };
        return defer.promise;
    },
    
    // Get list of available brands
    getBrandStations: function (key) {

        var defer=libQ.defer();
        
        const stationList = new Map();
        this.getBrands()
                .then((brands) => {
                    if (brands.has(key)){
                        let brand = brands.get(key);
                        brand["stations"].forEach((station) => {
                            // at this point we only need basic info about the stations, so just using the stations map is fine...
                            stationList.set(station, stations.get(station));
                        });
                    }
//                    console.log(stationList.size);
                    defer.resolve(stationList);
                })
                .fail((e) => {defer.reject(e); } );
        return defer.promise;
    },
    
    // Get a details for selected station
    getStreamUrl: function (stationKey) {
        
    //    var defer=libQ.defer();
        let stationDetails = stations.get(stationKey);       
        let streamURL = "";

        if (premiumUser) {
            if (preferACC && stationDetails['streamPremiumACC'])
                streamURL = stationDetails['streamPremiumACC']
            else if (stationDetails['streamPremiumMP3'])
                streamURL = stationDetails['streamPremiumMP3']
            if (uid) streamURL += "&listenerid=" + uid;
        }
        if (streamURL == "")  {// not premiumUser or failed find premium stream
            if (preferACC && stationDetails['streamACC'])
                streamURL = stationDetails['streamACC']
            else if (stationDetails['streamMP3'])
                streamURL = stationDetails['streamMP3']
            if (streamURL != ""){
                // If it is not a premium link we need to add 2 required parameters:
                // aw_0_1st.playerid=BMUK_html5
                // aw_0_1st.skey: time stamp
                streamURL += "&aw_0_1st.playerid=BMUK_html5&aw_0_1st.skey=" + Math.round(Date.now()/1e3);
            }
        }
        this.setNowPlayingURL(streamURL, stationKey);
        return streamURL;
    },
    
    setNowPlayingURL: function(streamUrl, stationKey) {
        
        currentPlayingURL = streamUrl; 
        if (streamUrl.startsWith(premiumStreamBase) && uid) {
            const url = new URL(streamUrl);
            console.log('Stream ID: ', url.pathname.slice(1) , ' , Search: ' , url.search);
        
            const searchParams = new URLSearchParams({stream: url.pathname.slice(1), uid: uid});
            
            NowPlayingPremiumUrl.search = searchParams.toString();
            realTimeNowPlaying = NowPlayingPremiumUrl.href;
            currentNowPlaying = NowPlayingPremiumUrl.href;
        } else {
            realTimeNowPlaying = '';
            currentNowPlaying = NowPlayingUrl +'/' + stationKey;
        }
        console.log('Now playing URL: ' , currentNowPlaying, ', real time: ', !(realTimeNowPlaying==''));
        return streamUrl;
    },
    
    // Get event details from URL
    getEventDetails: function (eventUrl) {

        var defer=libQ.defer();

        unirest
            .get(eventUrl)
            .then((response) => {
                if (response && response.status === 200) {
                    let eventDetails = response.body;
                    if (eventDetails.eventType == 'Song'){
                        let song = { 
                            'artist' : eventDetails.eventSongArtist,
                            'title': eventDetails.eventSongTitle,
                            'duration' : eventDetails.eventDuration,
                            'albumart' : eventDetails.eventImageUrl,
                            'timestamp' : Math.floor(new Date(eventDetails.eventStart).getTime() / 1000)
                        };
                        defer.resolve(song);
                    } else {
                        defer.resolve(eventDetails);
                    }
                } else {
                    defer.reject(new Error('Failed to retrieve event data from URL: ' + eventUrl));
                }
            });

        return defer.promise;
    },
    
    nowPlaying: function () {
        let defer=libQ.defer();
        
        if (realTimeNowPlaying) {
            this.getNowPlayingDetails(realTimeNowPlaying)
                .then(song => {
//                    console.log(JSON.stringify(song));
                    this.getEventDetails(song.url).then(song => {console.log(JSON.stringify(song)); defer.resolve(song);});
                });
        } else {
            this.getNowPlayingDetails(currentNowPlaying)
                .then(song => {console.log(JSON.stringify(song)); defer.resolve(song);});
        }
        return defer.promise;
    },
    
    realTimeNowPlaying: function () {
        return !(this.realTimeNowPlaying == '')
    },
    
    // Get nowPlaying details from URL
    getNowPlayingDetails: function (eventUrl) {

        var defer=libQ.defer();

        unirest
            .get(eventUrl)
            .header('Referer', 'https://planetradio.co.uk/')
            .header('Origin', 'https://planetradio.co.uk/')
            .then((response) => {
                console.log(JSON.stringify(response));
                if (response && response.status === 200) {
                    // not updated yet, as not really working so far...
                    let eventDetails = response.body;
                    if (eventDetails.EventType == 'S'){
                        let song = { 
                            'artist' : eventDetails.ArtistName,
                            'title': eventDetails.TrackTitle,
                            'duration' : eventDetails.TrackDuration,
                            'albumart' : eventDetails.ImageUrl,
                            'timestamp' : Math.floor(new Date(eventDetails.EventStart).getTime() / 1000)
                        };
                        defer.resolve(song);
                    } else {
                        defer.resolve(eventDetails);
                    }
                } else {
                    defer.reject(new Error('Failed to retrieve event data from URL: ' + eventUrl));
                }
            });
        return defer.promise;
    },
    
    setUserID: function(id) {
        return uid = id;
    },
    
    loginToBauerRadio: function(username, password) {

        var defer=libQ.defer();
        
        const targetcookiedomain1 = 'account.planetradio.co.uk';
        const targetcookiedomain2 = 'planetradio.co.uk';
        const target1 = 'https://account.planetradio.co.uk';
        const target2 = 'https://account.planetradio.co.uk/user/verify/?mode=login&targeturl=https://planetradio.co.uk&postmessage=1&sitecode=1';
        const targetstep1 = 'https://account.planetradio.co.uk/user/account/login/?mode=login&targeturl=https://planetradio.co.uk&postmessage=1&sitecode=1';
        const targetstep2 = 'https://account.planetradio.co.uk/user/api/login/';
        const targetrefresh = 'https://account.planetradio.co.uk//user/api/me/';
                        
        unirest
            .head(target1)
            .header('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8, application/json, text/plain, */*')
         //   .header('Cache-Control', 'no-cache')
         //        .header('referer', 'https://planetradio.co.uk/')
            .then((response) => {
                console.log(JSON.stringify(response));
                if (response && response.status === 200 && response.cookies && 'PHPSESSID' in response.cookies) {
                    // not updated yet, as not really working so far...
                    let cookieJar=unirest.jar();
                    let cookie = 'PHPSESSID='+response.cookies['PHPSESSID'];
                    console.log(cookie);
                    
                    cookieJar.add('PHPSESSID='+response.cookies['PHPSESSID'],'account.planetradio.co.uk/');
                    console.log(JSON.stringify(cookieJar));
                    let request=unirest.get(targetstep1)
                        .header('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8, application/json, text/plain, */*')
                        .header('Cache-Control', 'no-cache')
                        .jar(response.cookies)
                        .then((response) => {
                            console.log(JSON.stringify(response));
                        })

                    let eventDetails = response.body;
                    defer.resolve(eventDetails);
                } else {
                    defer.reject(new Error('Failed to retrieve event data from URL: ' ));
                }
            });
//    unirest.post('https://users.hotelradio.fm/api/index/login')
//        .send('username='+username)
//        .send('password='+password)
//        .then((response)=>{
//            if(response && 
//                response.cookies && 
//                'PHPSESSID' in response.cookies && 
//                response.status === 200 &&
//                response.body &&
//                'user' in response.body &&
//                'id' in response.body['user'])
//            {
//                self.sessionId=response.cookies['PHPSESSID']
//                
//                self.userId=response.body['user']["id"]
//                self.userEmail=response.body['user']["email"]
//                
//                self.config.set("loggedin",true)
//                defer.resolve()
//            } else {
//                defer.reject()
//            }   
//        })
//        
//        var cookieJar=unirest.jar()
//        cookieJar.add('PHPSESSID='+self.sessionId,'https://users.hotelradio.fm/api/user/updateip')
//
//        var request=unirest.post('https://users.hotelradio.fm/api/user/updateip')
//            .jar(cookieJar)

    return defer.promise;
}
};