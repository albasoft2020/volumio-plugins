'use strict';
var unirest=require('unirest');
var libQ=require('kew');

const stations = new Map();
const brands = new Map();
let lastBrandsUpdate = -1;

let premiumUser = true;
let preferACC = true;

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
                .post(`https://listenapi.planetradio.co.uk/api9.2/stations/gb${premium}`)
            //  .headers({'Accept': 'application/json', 'Content-Type': 'application/json'})
            //  .send({ "parameter": 23, "foo": "bar" })
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
                .post(`https://listenapi.planetradio.co.uk/api9.2/initweb/${key}`)
            //  .headers({'Accept': 'application/json', 'Content-Type': 'application/json'})
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
                .post(`https://listenapi.planetradio.co.uk/api9.2/brands`)
            //  .headers({'Accept': 'application/json', 'Content-Type': 'application/json'})
                .then((response) => {
                    if (response && response.status === 200) {
                        response.body.forEach((brand) => {
                            let brandID = brand["BrandCode"];
                            if (brands.has(brandID)) {
                                let updatedBrand = brands.get(brandID);
                                updatedBrand["name"] = brand['BrandName'];
                                updatedBrand["albumart"] = brand['BrandLogoImageUrl'];                                
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
        
        let stationList = [];
        
        this.getBrands()
                .then((brands) => {
                    if (brands.has(key)){
                        let brand = brands.get(key);
                        brand["stations"].forEach((station) => {
                            // at this point we only need basic info about the stations, so just using the stations map is fine...
                            stationList.push(stations.get(station));
                        });
                    }
                    console.log(stationList.length);
                    defer.resolve(stationList);
                })
                .fail((e) => {defer.reject(); } );
        return defer.promise;
    },
    
    // Get a details for selected station
    getStreamUrl: function (stationDetails) {
        
    //    var defer=libQ.defer();
                
        let streamURL = "";

        if (premiumUser) {
            if (preferACC && stationDetails['streamPremiumACC'])
                streamURL = stationDetails['streamPremiumACC']
            else if (stationDetails['streamPremiumMP3'])
                streamURL = stationDetails['streamPremiumMP3']
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
        return streamURL;
    }
};