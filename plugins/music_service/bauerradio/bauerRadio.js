'use strict';
var unirest=require('unirest');
var libQ=require('kew');

// ======================= START OF MODULE EXPORT
module.exports = {
// ======================= Tools (called from outside)

    // Get a map of BauerRadio live stations
    getLiveStations: function () {
    //function getLiveStations (){
        var defer=libQ.defer();

        unirest
            .post('https://listenapi.planetradio.co.uk/api9.2/stations/gb')
        //  .headers({'Accept': 'application/json', 'Content-Type': 'application/json'})
        //  .send({ "parameter": 23, "foo": "bar" })
            .then((response) => {
                if (response &&
                    response.status === 200) {
                    const stations = new Map()
                    for (var station in response.body) {
        //                    console.log(station);
                        stations.set(response.body[station]['stationCode'], {
                            "name": response.body[station]['stationName'],
                            "albumart": response.body[station]['stationListenBarLogo'],
                            "premiumOnlyStation": response.body[station]['premiumOnlyStation']
                        });
                    }
    //                console.log(response.body[28]);
    //                console.log(stations.get('jaz'))  
                    defer.resolve(stations);
                } else {
                    defer.reject();
                }
            });
            return defer.promise;
        },

    // Get a details for selected station
    getStationDetails: function (key) {

    var defer=libQ.defer();
    
    unirest
        .post(`https://listenapi.planetradio.co.uk/api9.2/initweb/${key}`)
    //  .headers({'Accept': 'application/json', 'Content-Type': 'application/json'})
    //  .send({ "parameter": 23, "foo": "bar" })
        .then((response) => {
            if (response &&
                response.status === 200) {
                let stationDetails = {
    //                    console.log(station);
                        "name": response.body['stationName'],
                        "albumart": response.body['stationListenBarLogo'],
                        "premiumOnlyStation": response.body['premiumOnlyStation'],
                        "streamACC": response.body['stationAACStream'],
                        "streamMP3": response.body['stationMP3Stream'],
                        "streamPremiumACC": "",
                        "streamPremiumMP3": ""
                    };
                    console.log(response.body['premiumEnabled']);
                    if (response.body['premiumEnabled']){
                        response.body['stationStreams'].forEach((stream) => {
//                            console.log(stream);
                            if (stream['streamPremium']) {
                                if (stream['streamQuality'] === "hq") {
                                    if (stream['streamType'] === 'adts')
                                        stationDetails['streamPremiumACC'] = stream['streamUrl'];
                                    else
                                        stationDetails['streamPremiumMP3'] = stream['streamUrl'];
                                }
                            }
                        });
                    }
//                console.log(response.body[28]);
//                console.log(stations.get('jaz'))  
                defer.resolve(stationDetails);
            } else {
                defer.reject();
            }
        });
        return defer.promise;
    },
    
        // Get a details for selected station
    getStreamUrl: function (stationDetails) {
        
    //    var defer=libQ.defer();
        
        let premiumUser = true;
        let preferACC = true;
        
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