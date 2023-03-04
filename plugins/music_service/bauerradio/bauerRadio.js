'use strict';
var unirest=require('unirest');
var cookie = require('cookie');
var libQ=require('kew');

const premiumStreamBase = 'https://stream.on.revma.com';
const NowPlayingPremiumUrl = new URL('https://stream.on.revma.com/api/user/command/now_playing');
const NowPlayingUrl = 'https://listenapi.planetradio.co.uk/api9.2/nowplaying';

const stations = new Map();
const brands = new Map();
let lastBrandsUpdate = -1;
const stationsStats = {
    total : 0,
    premium : 0,
    brands : 0,
    updated : 0
};

let premiumUser = false;
let preferACC = true;
let uid = '';
let realTimeNowPlaying = '';
let currentNowPlaying = '';
let bauerCookies = [];

const currentStation = {
    "ID": '',
    "title": '',
    "premium" : '',
    "nowPlaying":'',
    "realtimeNP":'',
    "albumart":'',
    "uri": '',
    "trackType":''
};
    
const currentUser = {
    email : '',
    premiumState : '',
    premiumExpiresAt : 0
};

// ======================= START OF MODULE EXPORT
module.exports = {
// ======================= Tools (called from outside)

    // Get a map of BauerRadio live stations
    getLiveStations: function (refresh) {

        var defer=libQ.defer();
        
        if (!refresh && (brands.size > 0) && (stations.size > 0)) {
            defer.resolve(stations);
            console.log('Returned existing map');
        }
        else {
            let premium = "";
            if (premiumUser) premium = "?premium=1"
            stations.clear();
            brands.clear();
            console.log('Requesting info through web. Include premium stations: ' + premiumUser);
            unirest
                .get(`https://listenapi.planetradio.co.uk/api9.2/stations/gb${premium}`)
                .then((response) => {
                    if (response &&
                        response.status === 200) {
                        stationsStats.updated = Date.now();
                        stationsStats.premium = 0;
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
                            if (response.body[station]['premiumOnlyStation']) stationsStats.premium++;
                            var brand;
                            if (brands.has(brandID)){
                                brand = brands.get(brandID);
                                brand["stations"].push(response.body[station]['stationCode']);
                            } else {
                                brand =  {
                                    "name": brandID,
                                    "albumart": response.body[station]['stationListenBarLogo'],
                                    "stations": [response.body[station]['stationCode']]
                                };
                            }
                            brands.set(brandID, brand);
                        }
                        stationsStats.total = stations.size;
                        stationsStats.brands = brands.size;
                        defer.resolve(stations);
                    } else {
                        defer.reject();
                    }
                });
        }
        return defer.promise;
    },
    
    getStationsStats: function () {
        if (stationsStats.total !== stations.size) {  // station stats are out of date...
            stationsStats.total = stations.size;
            stationsStats.brands = brands.size;
            stationsStats.updated = Date.now();
            
            let premStations = 0;
            for (var station in stations) {
                if (station.premiumOnlyStation) premStations++;
            }
            stationsStats.premium = premStations;
        }
        return stationsStats;
    },
    
    selectStation: function (stationKey) {
        
//        console.log('Station key again: ',stationKey, ' in map? ', stations.has(stationKey));
        let stationDetails = stations.get(stationKey);  
        let stream = this.getStreamUrl(stationDetails);

        this.setNowPlayingURL(stream.url, stationKey);

        currentStation.ID = stationKey;
        currentStation.title = stationDetails.name;
        currentStation.premium = stream.premium;
        currentStation.albumart = stationDetails.albumart;
        currentStation.uri = stream.url;
        currentStation.trackType =stream.type;
        
        return libQ.resolve(currentStation);
    },
    
    getActiveStationDetails: function () {
        return currentStation;
    },

    // Get a details for selected station
    getStationDetails: function (key, forceUpdate) {

        var defer=libQ.defer();

        if (stations.has(key) && (stations.get(key)["lastDetailsUpdate"] > 0) && !forceUpdate) {
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
                            "albumart": response.body['stationSquareLogo'],  // maybe better use 'stationSquareLogo' instead of 'stationListenBarLogo'?
                            "DADIChannelId": response.body['stationDADIChannelId'],
                            "brand": response.body['stationBrandCode'],
                            "premiumOnlyStation": response.body['premiumOnlyStation'],
                            "premiumEnabled": response.body['premiumEnabled'],
                            "streamACC": response.body['stationAACStream'],
                            "streamMP3": response.body['stationMP3Stream'],
                            "streamPremiumACC": "",
                            "streamPremiumMP3": "",
                            "episodeTitle": response.body['stationOnAir']['episodeTitle'],
                            "episodeDescription": response.body['stationOnAir']['episodeDescription'],
                            "episodeEnd": Date.parse(response.body['stationOnAir']['episodeStart']) + response.body['stationOnAir']['episodeDuration']*1000
                        };
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
                        defer.resolve(stationDetails);
                    } else {
                        defer.reject();
                    }
                });
        };
        return defer.promise;
    },

        // Get a details for selected station
    getStationNowPlayingInfo: function (key) {

        let defer=libQ.defer();
        
        if (!key) key = currentStation.ID;
        if (stations.has(key)) {
            console.log('Fetching details. Station in map: ', stations.has(key));
            unirest
                .get(`https://listenapi.planetradio.co.uk/api9.2/initweb/${key}`)
                .then((response) => {
                    if (response && response.status === 200) {
                        let stationNowPlaying = {
                            "nowPlayingTrack": response.body['stationNowPlaying']['nowPlayingTrack'],
                            "nowPlayingArtist": response.body['stationNowPlaying']['nowPlayingArtist'],
                            "nowPlayingImage": response.body['stationNowPlaying']['nowPlayingImage'],
                            "nowPlayingDuration": response.body['stationNowPlaying']['nowPlayingDuration'],
                            "episodeTitle": response.body['stationOnAir']['episodeTitle'],
                            "episodeDescription": response.body['stationOnAir']['episodeDescription'],
                            "episodeEnd": Date.parse(response.body['stationOnAir']['episodeStart']) + response.body['stationOnAir']['episodeDuration']*1000
                        }; 
                        defer.resolve(stationNowPlaying);
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
    getStreamUrl: function (stationDetails) {
        
    //    var defer=libQ.defer();
//        let stationDetails = stations.get(stationKey);       
        let streamURL = "";
        let type = "";
        let premium = false;

        if (premiumUser) {
            if (preferACC && stationDetails['streamPremiumACC'])
                { streamURL = stationDetails['streamPremiumACC']; type ='aac'; premium = true; }
            else if (stationDetails['streamPremiumMP3'])
                { streamURL = stationDetails['streamPremiumMP3']; type ='mp3'; premium = true; }
            if (uid) streamURL += "&listenerid=" + uid;
        }
        if (streamURL == "")  {// not premiumUser or failed find premium stream
            if (preferACC && stationDetails['streamACC'])
                { streamURL = stationDetails['streamACC']; type ='aac'; }
            else if (stationDetails['streamMP3'])
                { streamURL = stationDetails['streamMP3']; type ='mp3'; }
//            if (streamURL != ""){
//                // If it is not a premium link we need to add 2 required parameters:
//                // aw_0_1st.playerid=BMUK_html5
//                // aw_0_1st.skey: time stamp
//                streamURL += "&aw_0_1st.playerid=BMUK_html5&aw_0_1st.skey=" + Math.round(Date.now()/1e3);
//            }
        }
        if (streamURL != ""){
            // Seems like we need to add 2 required parameters:
            // aw_0_1st.playerid=BMUK_html5
            // aw_0_1st.skey: time stamp
            streamURL += "&aw_0_1st.playerid=BMUK_html5&aw_0_1st.skey=" + Math.round(Date.now()/1e3);
        }
        return {url: streamURL, type: type, premium: premium};
    },
    
    setNowPlayingURL: function(streamUrl, stationKey) {
        
        if (streamUrl.startsWith(premiumStreamBase) && uid) {
            const url = new URL(streamUrl);
            console.log('Stream ID: ', url.pathname.slice(1) , ' , Search: ' , url.search);
        
            const searchParams = new URLSearchParams({stream: url.pathname.slice(1), uid: uid});
            
            NowPlayingPremiumUrl.search = searchParams.toString();
            realTimeNowPlaying = NowPlayingPremiumUrl.href;
            currentNowPlaying = NowPlayingUrl +'/' + stationKey;
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

        if (eventUrl.split('/').slice(-1) < 0) {  // If event URL ends in a negative number (or always -1?) its a station jimgle...
            defer.resolve();
        }
        else {
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
                        if (eventDetails.eventImageUrl === 'https://media.bauerradio.com/image/upload/tracks/0.jpg') 
                            song.albumart = currentStation.albumart;
                        defer.resolve(song);
                    } else {
                        defer.resolve(eventDetails);
                    }
                } else {
                    defer.reject(new Error('Failed to retrieve event data from URL: ' + eventUrl));
                }
            });
        }

        return defer.promise;
    },
    
    nowPlaying: function () {
        let defer=libQ.defer();
        
        if (realTimeNowPlaying) {
            this.getNowPlayingDetails(realTimeNowPlaying)
            .then(song => {
//                    console.log(JSON.stringify(song)); 
                if (song.url){
                    this.getEventDetails(song.url)
                        .then(song => {
//                            console.log(JSON.stringify(song)); 
                            defer.resolve(song);
                        });
                } else {
                    // Shouldn't really happen unless there is an issue with the service...
                    console.log('Bauerradio: Empty real-time metadata, falling back to standard data'); 
                    this.getNowPlayingDetails(currentNowPlaying)
                        .then(song => {
//                                console.log(JSON.stringify(song)); 
                            defer.resolve(song);
                        });
                }
            });
        } else {
            this.getNowPlayingDetails(currentNowPlaying)
            .then(song => {
//                    console.log(JSON.stringify(song)); 
                defer.resolve(song);
            });    
        }
        return defer.promise;
    },
    
    realTimeNowPlaying: function () {
        return !(realTimeNowPlaying == '')
    },
    
    // Get nowPlaying details from URL
    getNowPlayingDetails: function (eventUrl) {

        var defer=libQ.defer();

        unirest
            .get(eventUrl)
            .header('Referer', 'https://planetradio.co.uk/')
            .header('Origin', 'https://planetradio.co.uk/')
            .then((response) => {
//                console.log(JSON.stringify(response));
                if (response && response.status === 200) {
                    // not updated yet, as not really working so far...
                    let eventDetails = response.body;
                    if ((eventDetails.EventType == 'S')  || (eventDetails.EventType == '0')){
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
        let defer=libQ.defer();
        
        if (id.expires <= Math.floor(Date.now() / 1000))
            this.getListenerID().then(newID => {uid = newID.uid; defer.resolve(newID);});
        else {uid = id.uid; defer.resolve(id);}
        
        return defer.promise;
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
            // We don't need to get the body; all the info we need is in the return header...
            .head(targetstep1)
            .header('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8, application/json, text/plain, */*')
//          // 'User-Agent' seems to be required! Took me ages to figure out...
//          This is the firefox string:
//            .header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/109.0')
//          But maybe using a curl string is a bit closer to reality
            .header('User-Agent', 'curl/7.74.0')
//          All these do not seem to be required after all:
//            .header('Accept-Language', 'en-GB,en;q=0.5')
//            .header('Accept-Encoding', 'gzip, deflate, br')
//            .header('Sec-Fetch-Dest', 'document')
//            .header('Sec-Fetch-Mode', 'navigate')
//            .header('Sec-Fetch-Site', 'none')
//            .header('Sec-Fetch-User', '?1')
//            .header('Cache-Control', 'no-cache')
            .then((response) => {
//                console.log('Response headers: ' ,JSON.stringify(response.headers));
                if (response && response.status === 200 && response.cookies && 'XSRF-TOKEN' in response.cookies) {
//                    // the following does NOT work, as it only sees the empty XSRF-TOKEN:
//                    console.log('Cookies: ',JSON.stringify(response.cookies));
                    bauerCookies = response.headers['set-cookie'];
//                    console.log('Set-Cookie array: ',JSON.stringify(bauerCookies));
//                    let cookieJar=unirest.jar();
                    // Dirty hack: assumes the relevant cookie is always the first one...
                    let XSRFtoken = cookie.parse(response.headers['set-cookie'][0]);
//                    console.log('XSRF-TOKEN cookie: ', XSRFtoken);
//
                    //cookieJar.add(response.headers['set-cookie'][0]);
//                    console.log('Cookie jar: ',JSON.stringify(cookieJar));
                    unirest.post(targetstep2)
                        .header('Accept', 'application/json, text/plain, */*')
                        .header('Referer', targetstep1)
                        .header('Origin', target1)
                        .header('Accept-Language', 'en-GB,en;q=0.9')
                        .header('Cache-Control', 'max-age=0')
                        .header('x-xsrf-token', XSRFtoken['XSRF-TOKEN'])	// Special for PlanetRadio
                        .header('content-type', 'application/json;charset=UTF-8') // Special for PlanetRadio
                        .header('cookie', bauerCookies)
//                        .jar(response.cookies)
                        .send({
                            "email": username,
                            "password": password
                        })
                        .then((response) => {
//                            console.log('Step2 response: ', JSON.stringify(response));
                            if (response.status === 200){
                                // Successfully logged in
//                                console.log('All Cookies: ',JSON.stringify(bauerCookies));
                                currentUser.email = username;
                                if ((response.body) && (response.body.miscellaneous)){
                                    premiumUser = ['active','trial'].includes(response.body.miscellaneous.premiumState);
                                    currentUser.premiumState = response.body.miscellaneous.premiumState;
                                    currentUser.premiumExpiresAt = response.body.miscellaneous.premiumExpiresAt
//                                    console.log('PremiumState: ', response.body.miscellaneous.premiumState);
                                } else premiumUser = false;
//                                console.log('Premium user? ', premiumUser);
                                if (response.headers['set-cookie']) bauerCookies = bauerCookies.concat(response.headers['set-cookie']);
//                                let userDetails = response.body;
                                defer.resolve(currentUser);
                            } else if (response.status === 403){
                                defer.reject(response.body);
                            } else if (response.status === 404){
//                                defer.reject(new Error('Credentials not valid'));
                                defer.reject('Credentials not valid');
                             }
                        });
                } else {
                    defer.reject('Failed to retrieve response from account URL');
                }
            });
        return defer.promise;
    },
    
    getCurrentUser: function(){
        return currentUser;
    },

    forgetCurrentUser: function(){
        currentUser.email = '';
        currentUser.premiumState = '';
        currentUser.premiumExpiresAt = 0;
        premiumUser = false;
        bauerCookies = [];
        return currentUser;
    },
    
    getCurrentUserDescription: function(){
        let desc = 'Not logged in.';
        
        if (currentUser.email) {
            desc = currentUser.email;
            if (['active','trial'].includes(currentUser.premiumState)) {
                desc += ' (' + currentUser.premiumState + ' premium user, with current subscription valid until ' + currentUser.premiumExpiresAt + ')'
            } else {
                desc += ' (no current premium subscription)';
            }
        }
        return desc;
    },

    checkIfLoggedIn: function() {

        var defer=libQ.defer();
        
        const targetcookiedomain1 = 'account.planetradio.co.uk';
        const targetcookiedomain2 = 'planetradio.co.uk';
        const target1 = 'https://account.planetradio.co.uk';
        const targetrefresh = 'https://account.planetradio.co.uk//user/api/me/';
                        
        unirest
            // We don't need to get the body; all the info we need is in the return header...
            .get(targetrefresh)
            .header('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8, application/json, text/plain, */*')
            .header('User-Agent', 'curl/7.74.0')
            .header('cookie', bauerCookies)
            .then((response) => {
                console.log('Response: ' ,JSON.stringify(response));
            });
        return defer.promise;
    },
    
    getListenerID: function() {

        var defer=libQ.defer();
        
        const target1 = 'https://account.planetradio.co.uk';
        const target2 = 'https://synchrobox.adswizz.com/register2.php?aw_0_req.gdpr=true';
                        
        unirest
            // We don't need to get the body; all the info we need is in the return header...
            .head(target2)
            .header('Accept', '*/*')
//          // 'User-Agent' , not needed but passing this in header seems to affect which ID gets returned...
            .header('User-Agent', 'curl/7.74.0')
            .header('Referer', target1)
            .then((response) => {
//                console.log('Response headers: ' ,JSON.stringify(response));
                if (response && response.status === 200 && 'OAID' in response.cookies) {
//                    let listenerID = response.cookies['OAID']; //cookie.parse(response.headers['set-cookie'][0]);
//                    console.log('ListernerID cookie: ', listenerID, 'Unirest cookies: ', response.cookies);
                    defer.resolve({uid: response.cookies['OAID'], expires: Date.parse(response.cookies.Expires)/1000 });
                } else {
                    if (response.body.error)
                        defer.reject(new Error('Failed to retrieve listener ID: ', response.body.error ));
                }
            });
    return defer.promise;
}
};