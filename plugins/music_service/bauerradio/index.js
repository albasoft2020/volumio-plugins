'use strict';
//var unirest=require('unirest');
var libQ=require('kew');
//var ip = require('public-ip');
var fs=require('fs-extra');
//var cron = require('node-schedule');
//var moment=require('moment');
var NanoTimer = require('nanotimer');

var bRadio = require('./bauerRadio');  // BauerRadio specific code

var tokenExpirationTime;

const bigTimeStamp = 4000000000000;
const nowPlayingRefresh = 10000;  // time in ms
const npInterval = nowPlayingRefresh + 'm';
// Settings for splitting composite titles (as used for many webradio streams)
const compositeTitle =
        {
            separator: " - ",
            indexOfArtist: 1,
            indexOfTitle: 0
        };
        
/**
 * CONSTRUCTOR
 * 
 * This plugin plays PlanetRadio stations (BauerRadio) in the UK, including Premium stations. 
 * It is based on the hotelradio plugin as well as elements of the RadioParadise plugin.
 */
module.exports = ControllerBauerRadio;

function ControllerBauerRadio(context) {
	var self=this;

    this.context = context;
    this.commandRouter = this.context.coreCommand;
    this.logger = this.context.logger;
    this.configManager = this.context.configManager;
    this.serviceName = 'bauerradio';
    
//    this.updateService = 'mpd';
    this.updateService = 'bauerradio';
    this.currentStation;
    
    this.debug = 0;  // define debug level
    
    this.userEmail = '';
    this.isLoggedIn = false;
    
    this.npTimer = new NanoTimer();
    
    this.songEndTime = bigTimeStamp;
    this.previousSong = '';
    this.currentSong = '';
    this.state = {artist: '', title: '', status: 'stop'};
}

ControllerBauerRadio.prototype.getConfigurationFiles = function () {
    var self = this;

    return ['config.json'];
};

ControllerBauerRadio.prototype.onVolumioStart = function () {
    var defer=libQ.defer();

    this.mpdPlugin=this.commandRouter.pluginManager.getPlugin('music_service', 'mpd');
    var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
    this.config = new (require('v-conf'))();
    this.config.loadFile(configFile);
    this.debug = this.config.get('debugLevel', 0);

    defer.resolve('');

    return defer.promise;
};

ControllerBauerRadio.prototype.onStart = function () {
    var defer=libQ.defer();

    this.loadI18n();
    this.startupLogin();
    defer.resolve('');

    return defer.promise;
};

ControllerBauerRadio.prototype.loadI18n = function () {
    var self=this;

    var language_code = this.commandRouter.sharedVars.get('language_code');
    fs.readJson(__dirname+'/i18n/strings_en.json', (err, defaulti18n) => {
        if (err) {} else {
            self.i18nStringsDefaults = defaulti18n;
            fs.readJson(__dirname+'/i18n/strings_'+language_code+".json", (err, langi18n) => {
                if (err) {
                    self.i18nStrings = self.i18nStringsDefaults;
                } else {
                    self.i18nStrings = langi18n;
                }
            });
        }
    });
};

ControllerBauerRadio.prototype.getI18n = function (key) {
    var self=this;

    if (key.indexOf('.') > 0) {
        var mainKey = key.split('.')[0];
        var secKey = key.split('.')[1];
        if (self.i18nStrings[mainKey][secKey] !== undefined) {
            return self.i18nStrings[mainKey][secKey];
        } else {
            return self.i18nStringsDefaults[mainKey][secKey];
        }

    } else {
        if (self.i18nStrings[key] !== undefined) {
            return self.i18nStrings[key];
        } else {
            return self.i18nStringsDefaults[key];
        }
    }
};

ControllerBauerRadio.prototype.startupLogin = function () {
    let self=this;

    let listenerID = { uid : '', expires : 0};
    let id = self.config.get("listenerID");
    
    if (id) { listenerID.uid = id; listenerID.expires = self.config.get("listenerIDexpiry"); };
    if (self.debug) self.logger.info('[BauerRadio] Starting up. Saved listenerID: ', listenerID);
    
    bRadio.setUserID(listenerID)
            .then(newID => {
                if (newID.uid && (listenerID.uid != newID.uid)) {
                    self.config.set("listenerID", newID.uid);
                    if (self.debug > 2) self.logger.info('[BauerRadio] Updated listenerID: ' + newID.uid);
                }
                if (newID.expires && (listenerID.expires != newID.expires)) {
                    self.config.set("listenerIDexpiry", newID.expires);
                    if (self.debug > 2) self.logger.info('[BauerRadio] Updated listenerID expiry timestamp: ' + newID.expires);
                } else {
                    if (self.debug > 2) self.logger.info('[BauerRadio] Kept same listenerID: ' + newID.uid);                    
                }
            });                
    self.shallLogin()
        .then(()=> self.loginToBauerRadio(this.config.get('username'), this.config.get('password')))
        .then(()=>{
            this.userEmail = this.config.get('username');
            this.isLoggedIn = true;
        });
    self.addToBrowseSources();
};

ControllerBauerRadio.prototype.shallLogin = function () {
    var self=this;
    var defer=libQ.defer()
    
//    this.isLoggedIn = this.config.get("loggedin",false);
    if(this.config.get("username")
        && this.config.get("username")!=""
        && this.config.get("password")
        && this.config.get("password")!="")
    {
        if (self.debug > 2) self.logger.info('[BauerRadio] Sufficient credentials to try login.');
        defer.resolve();
    } else 
    {
        if (self.debug > 2) self.logger.info('[BauerRadio] Not enough saved credentials.');
        defer.reject();
    }
    
    return defer.promise;
};

ControllerBauerRadio.prototype.loginToBauerRadio=function(username, password) {
    return bRadio.loginToBauerRadio(username, password);
};

ControllerBauerRadio.prototype.onStop = function () {
    var self = this;
    var defer=libQ.defer();

    self.commandRouter.volumioRemoveToBrowseSources('BauerRadio.fm');
//    self.stopRefreshCron();

    defer.resolve('');

    return defer.promise;
};

ControllerBauerRadio.prototype.addToBrowseSources = function () {
    var self = this;

    var data = {name: 'BauerRadio.fm', uri: 'BauerRadio://',plugin_type:'music_service',plugin_name:'bauerradio',albumart:'/albumart?sectionimage=music_service/bauerradio/icons/PlanetRadio.png'};
    if (self.debug > 2) self.logger.info('[BauerRadio] Adding browse source with: ' + JSON.stringify(data));
    return self.commandRouter.volumioAddToBrowseSources(data);
};

ControllerBauerRadio.prototype.handleBrowseUri = function (curUri) {
    
    switch(curUri)
    {
        case 'BauerRadio://':
            return this.handleRootBrowseUri();

        default:
        {
            if (curUri.startsWith('BauerRadio://stations')) return this.handleStationBrowseUri(curUri);
            else if (curUri.startsWith('BauerRadio://brands')) {
                if (curUri == 'BauerRadio://brands') {
                    return this.handleBrandBrowseUri(curUri);
                }
                else return this.handleBrandsStationsBrowseUri(curUri);       
            }
            else if (curUri.startsWith('BauerRadio://listenagain')) {
                if (curUri == 'BauerRadio://listenagain') {
                    return this.handleListenAgainBrowseUri(curUri);
                }
                else return this.handleListenAgainBrowseUri(curUri); 
            }
        }
    }
};

ControllerBauerRadio.prototype.handleRootBrowseUri=function() {
    let defer=libQ.defer();
    let self=this;

    let groupItems = [];
    
    groupItems.push({
        "type": "item-no-menu",
        "title": 'Stations by Brand',
        "albumart": '/albumart?sectionimage=music_service/bauerradio/icons/PlanetRadio.png',
        "uri": 'BauerRadio://brands'
    });
    
    groupItems.push({
        "type": "item-no-menu",
        "title": 'All Live Radio Stations',
//        "albumart": '',
        "icon": 'fa fa-music',
        "uri": 'BauerRadio://stations'
    });
    
//    groupItems.push({
//        "type": "item-no-menu",
//        "title": 'Listen again',
////        "albumart": '',
//        "icon": 'fa fa-repeat',
//        "uri": 'BauerRadio://listenagain'
//    });
    
    let browseResponse={
        "navigation": {
            "lists": [
                {
                    "type": "title",
                    "title": "Favourites",
                    "availableListViews": [
                        "grid", "list"
                    ],
                    "items": [{
                        "type": "webradio",
                        "title": 'Jazz FM',
//                        "albumart": value['albumart'],
                        "uri": 'BauerRadio://stations/jaz',
                        "service":"bauerradio"
                        },{
                        "type": "item-no-menu",
                        "title": 'Listen again Jazz FM',
                //        "albumart": '',
                        "icon": 'fa fa-repeat',
                        "uri": 'BauerRadio://listenagain/jaz'
                    }]
                },
                {
                    "type": "title",
                    "title": "TRANSLATE.BAUERRADIO.BRANDS",
                    "availableListViews": [
                        "grid", "list"
                    ],
                    "items": groupItems
                },
                {
                    "type": "title",
                    "title": "Catch up",
                    "availableListViews": [
                        "grid", "list"
                    ],
                    "items": [{
                        "type": "item-no-menu",
                        "title": 'Listen again',
                //        "albumart": '',
                        "icon": 'fa fa-repeat',
                        "uri": 'BauerRadio://listenagain'
                    }]
                }
            ]
        }
    };
    self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);
    // fetch list of stations (if needed)
    bRadio.getLiveStations()
        .then((response) => {
            self.logger.info('[BauerRadio] Checked live station list. Number of stations found: ' + response.size);
            defer.resolve(browseResponse);
        });
    return defer.promise;
};

ControllerBauerRadio.prototype.handleStationBrowseUri=function(curUri) {

    var defer=libQ.defer();
    var self=this;

    if (self.debug > 0) self.logger.info('[BauerRadio] handleStationBrowseUri called with: ' + curUri);
    
    var stationItems = [];
    
    bRadio.getLiveStations()
        .then((response) => {
            response.forEach((value, key) => { 
                stationItems.push({
                    "type": "webradio",
                    "title": value['name'],
                    "albumart": value['albumart'],
                    "uri": `${curUri}/${key}`,
                    "service":"bauerradio"
                });
            });
            
            var browseResponse={
                "navigation": {
                    "lists": [
                        {
                            "type": "title",
                            "title": "TRANSLATE.BAUERRADIO.STATIONS",
                            "availableListViews": [
                                "grid", "list"
                            ],
                            "items": stationItems
                        }]
                }
            };
            self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);

            if (self.debug > 2) self.logger.info('[BauerRadio] Listed live stations');
            defer.resolve(browseResponse);

        });
    return defer.promise;
};

ControllerBauerRadio.prototype.handleBrandBrowseUri=function(curUri) {

    var defer=libQ.defer();
    var self=this;

    if (self.debug > 0) self.logger.info('[BauerRadio] handleBrandBrowseUri called with: ' + curUri);
    
    var brandItems = [];
    
    bRadio.getBrands()
        .then((response) => {
            response.forEach((value, key) => { 
                brandItems.push({
                    "type": "item-no-menu",
                    "title": value['name'],
                    "albumart": value['albumart'],
                    "uri": `${curUri}/${key}`,
//                    "service":"bauerradio"
                });
            });
            
            var browseResponse={
                "navigation": {
                    "lists": [
                        {
                            "type": "title",
                            "title": "TRANSLATE.BAUERRADIO.BRANDS",
                            "availableListViews": [
                                "grid", "list"
                            ],
                            "items": brandItems
                        }]
                }
            };
            self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);

            self.logger.info('[BauerRadio] Listed brands');
            defer.resolve(browseResponse);

        });
    return defer.promise;
};

ControllerBauerRadio.prototype.handleListenAgainBrowseUri=function(curUri) {

    var defer=libQ.defer();
    var self=this;

    if (self.debug > 0) self.logger.info('[BauerRadio] handleListenAgainBrowseUri called with: ' + curUri);
    
    let browseResponse = {};
    let sectionTitle = "TRANSLATE.BAUERRADIO.LISTENAGAIN";
    self.commandRouter.translateKeys(sectionTitle, self.i18nStrings, self.i18nStringsDefaults);
    
    if (curUri === 'BauerRadio://listenagain') { // top level of listen again: refresh list of available episodes and display them by date
        var stationItems = [];
        bRadio.getLiveStations()
        .then((response) => {
            response.forEach((value, key) => { 
                if (value['hasSchedule'] === 1) {
                    stationItems.push({
                        "type": "item-no-menu",
                        "title": value['name'],
                        "albumart": value['albumart'],
                        "uri": `${curUri}/${key}`
                    });
                }
            });
            browseResponse={
                "navigation": {
                    "lists": [
                        {
                            "type": "title",
                            "title": "TRANSLATE.BAUERRADIO.LISTENAGAIN",
                            "availableListViews": [
                                "grid", "list"
                            ],
                            "items": stationItems
                        }]
                }
            };
            self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);

            if (self.debug > 2) self.logger.info('[BauerRadio] Listed stations with listen again shows');
            defer.resolve(browseResponse);

        });
    }
    else if (curUri.split('/').length === 4) {
        var listenDates = [];
        let stationID=curUri.split('/').pop();
        bRadio.getListenAgainEpisodes(stationID)
            .then((response) => {
                    this.listenAgainEpisodes = response;
                    this.listenAgainStation = stationID;
                    for (var date in response) {
                    listenDates.push({
                        "type": "item-no-menu",
                        "title": new Date(date).toLocaleDateString('en-GB', { weekday: "short", month: "short", year:"numeric", day: "numeric"}),
    //                    "albumart": value['albumart'],
//                        "icon": "fa fa-folder-open-o",
                        "icon": "fa fa-calendar",
                        "uri": `${curUri}/${date}`
    //                    "service":"bauerradio"
                    });
                }

                browseResponse={
                    "navigation": {
                        "lists": [
                            {
                                "type": "title",
                                "title": "TRANSLATE.BAUERRADIO.LISTENAGAIN",
                                "availableListViews": [
                                    "grid", "list"
                                ],
                                "items": listenDates
                            }]
                    }
                };
                self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);
                
                bRadio.getStationDetails(stationID)
                        .then(station => { 
                            browseResponse.navigation.lists[0]['title'] += ' for ' + station.name;
                            self.logger.info('[BauerRadio] Listed available listen again dates');
                            defer.resolve(browseResponse);
                        });
            });
        } else { // episode level of listen again: display individual episodes 
            let episodes = [];
            let date=curUri.split('/').pop(); 
            for (var show in this.listenAgainEpisodes[date]) {
                    episodes.push({
                        "type": "webradio",
                        "title": this.listenAgainEpisodes[date][show]['title'],
                        "albumart": this.listenAgainEpisodes[date][show]['imageurl_square'],
//                        "icon": "fa calendar",
                        "uri": `${curUri}/${show}`,
                        "service":"bauerradio"
                    });
                }

                browseResponse={
                    "navigation": {
                        "lists": [
                            {
                                "type": "title",
                                "title": new Date(date).toLocaleDateString('en-GB', { weekday: "short", month: "short", year:"numeric", day: "numeric"}),
                                "availableListViews": [
                                    "grid", "list"
                                ],
                                "items": episodes
                            }]
                    }
                };
                self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);

                self.logger.info('[BauerRadio] Listed brands');
                defer.resolve(browseResponse);
        }
    return defer.promise;
};

ControllerBauerRadio.prototype.handleBrandsStationsBrowseUri=function(curUri) {

    var defer=libQ.defer();
    var self=this;

    let brandID=curUri.split('/').pop(); // get last element of uri
    if (self.debug > 0) self.logger.info('[BauerRadio] handleStationBrowseUri called with: ' + curUri + ', i.e. brandID: ' + brandID);
    
    var stationItems = [];
    
    bRadio.getBrandStations(brandID)
        .then((response) => {
            response.forEach((value, key) => { 
                stationItems.push({
                    "type": "webradio",
                    "title": value['name'],
                    "albumart": value['albumart'],
                    "uri": `${curUri}/${key}`,
                    "service":"bauerradio"
                });
            });
            
            var browseResponse={
                "navigation": {
                    "lists": [
                        {
                            "type": "title",
                            "title": "TRANSLATE.BAUERRADIO.STATIONS",
                            "availableListViews": [
                                "grid", "list"
                            ],
                            "items": stationItems
                        }]
                }
            };
            self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);

            if (self.debug > 2) self.logger.info('[BauerRadio] Listed live stations');
            defer.resolve(browseResponse);

        });
    return defer.promise;
};

ControllerBauerRadio.prototype.explodeUri = function(curUri) {
    var defer=libQ.defer();
    var self=this;
    
    let explodeResp =  {
                "uri": curUri,
                "service": "bauerradio",
                "name": "",
                "title": "Bauer Radio Station",
                "album": "",
                "type": "track",
                "albumart": ""
            };
            
    let parts = curUri.split('/');
    if (parts[2] == 'listenagain') {
        if (self.debug > 0) self.logger.info('[BauerRadio] explodeUri called with: ' + curUri);
        explodeResp["name"] = this.listenAgainEpisodes[parts[4]][parts[5]]['title'];
        explodeResp["albumart"] = this.listenAgainEpisodes[parts[4]][parts[5]]['imageurl_square'];
        defer.resolve([explodeResp]);
    } else {
        const stationID= curUri.split('/').pop();
        if (self.debug > 0) self.logger.info('[BauerRadio] explodeUri called with: ' + curUri + ', Ch: ' + stationID);

        bRadio.getStationDetails(stationID)
            .then((response) => {
                explodeResp["name"] = response["name"];
                explodeResp["albumart"] = response["albumartLarge"] || response["albumart"];
                defer.resolve([explodeResp]);
            });
    }
    return defer.promise;
};

ControllerBauerRadio.prototype.getStreamUrl = function (curUri) {
    var defer=libQ.defer();
    var self=this;

    let stationID = curUri.split('/').pop();

    let explodeResp = {
        "uri": ""
    };
    
    let parts = curUri.split('/');
    if (parts[2] == 'listenagain') { // listen again episode
        bRadio.selectListenAgainEpisode(this.listenAgainEpisodes[parts[4]][parts[5]], this.listenAgainStation)
                .then(response => {
                    self.currentStation = response;
                    bRadio.getPlaylist(this.listenAgainEpisodes[parts[4]][parts[5]])
                            .then(pl => {
                                self.playlist = pl;
                                if (self.debug > 0) self.logger.info('[BauerRadio] Playlist items: ' + pl.length);                        
                    });
                    explodeResp["title"] = response["title"];
                    explodeResp["albumart"] = response["albumart"];
                    explodeResp["uri"] = response["uri"];
                    if (self.debug > 0) self.logger.info('[BauerRadio] getStreamUrl returned: ' + explodeResp["uri"]);
                    defer.resolve(explodeResp);
                });
    } else {  // live station
        bRadio.getStationDetails(stationID)
            .then((response) => {
    //            explodeResp["name"] = response["name"];
                explodeResp["title"] = response["name"];
                explodeResp["albumart"] = response["albumartLarge"] || response["albumart"];
                bRadio.selectStation(stationID)
                        .then(station => {
                            self.currentStation = station;
                            explodeResp["uri"] = station.uri;
                            if (self.debug > 0) self.logger.info('[BauerRadio] getStreamUrl returned: ' + explodeResp["uri"]);
                            defer.resolve(explodeResp);
                        });
            });
    }
    return defer.promise;
};

/**
* Standard method called to start playback of a music service

 * @param {type} track
 * @returns {nm$_index.ControllerBauerRadio.prototype.clearAddPlayTrack.defer|Object.prototype.clearAddPlayTrack.defer} */
ControllerBauerRadio.prototype.clearAddPlayTrack = function(track) {
    var self = this;
    var defer=libQ.defer();

    self.commandRouter.pushConsoleMessage('[' + Date.now() + '] ' + 'ControllerBauerRadio::clearAddPlayTrack');
    

    self.getStreamUrl(track.uri)
        .then(function(track) {
            return self.mpdPlugin.sendMpdCommand('stop',[])
                .then(function() {
                    return self.mpdPlugin.sendMpdCommand('clear',[]);
                })
                .then(function() {
                    return self.mpdPlugin.sendMpdCommand('add "'+track.uri+'"',[]);
                })
                .then(function() {
                    // try with 'consumeIgnoreMetadata' set to true
//                    self.commandRouter.stateMachine.setConsumeUpdateService('mpd', true);
//                    self.currentStation = track;
//                    setTimeout(self.setMetadata.bind(self), 2000, 'play')
                    return self.mpdPlugin.sendMpdCommand('play',[]);
                })
                .then(() => { 
                    // Maybe stop pretending to be 'mpd' and just admit who is in control...
                    self.commandRouter.stateMachine.setConsumeUpdateService(self.serviceName);
                    setTimeout(self.startNowPlayingTimer.bind(self), 2000, 'start'); 
                    defer.resolve();
                }) 
                .fail(function (e) {
                    self.logger.error('Could not Clear and Play BauerRadio Track: ' + e);
                    defer.reject(new Error());
                })
            ;
        })
        .fail(function(e)
        {   self.logger.error('Could not get Bauer radio Stream URL: ' + e);
            defer.reject(new Error());
        });

    return defer;
};

/**
* Stop playback and set metadata back to station defaults
* @returns {unresolved} 
*/
 ControllerBauerRadio.prototype.stop = function() {
    var self = this;
    self.logger.info('[BauerRadio] Stopped playback');

    return self.setMetadata('stop').then(() => self.mpdPlugin.sendMpdCommand('stop', []));
};

/**
* Needed as volumio also seems to expect a pause method whenever duration of a stream is not 0
* Use this to also stop the stream similar to the stop method.
* @returns {unresolved} 
*/
ControllerBauerRadio.prototype.pause = function() {
    var self = this;
    self.logger.info('[BauerRadio] Can\'t pause, so stopping playback');

    return (self.setMetadata('stop').then(()=> self.commandRouter.stateMachine.stop()));
};

ControllerBauerRadio.prototype.getUIConfig = function () {
    var self = this;

    var defer=libQ.defer();
    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+this.commandRouter.sharedVars.get('language_code')+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            if (self.isLoggedIn) {
                uiconf.sections[0].content[0].hidden=true;
                uiconf.sections[0].content[1].hidden=true;
                uiconf.sections[0].content[2].hidden=true;
                uiconf.sections[0].content[3].hidden=true;
                //uiconf.sections[0].content[4].hidden=false;
                
                uiconf.sections[0].description=self.getI18n("BAUERRADIO.LOGGED_IN_EMAIL")+bRadio.getCurrentUserDescription();
                uiconf.sections[0].saveButton.label=self.getI18n("COMMON.LOGOUT")
                uiconf.sections[0].onSave.method="clearAccountCredentials"
            } else {
                uiconf.sections[0].content[0].hidden=false;
                uiconf.sections[0].content[1].hidden=false;
                uiconf.sections[0].content[2].hidden=false;
                uiconf.sections[0].content[3].hidden=true;
                //uiconf.sections[0].content[4].hidden=true;

//                switch(self.commandRouter.sharedVars.get('language_code'))
//                {
//                    case 'de':
//                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/volumio";
//                    break
//
//                    case 'it':
//                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/it/volumio";
//                    break
//
//                    case 'fr':
//                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/fr/volumio";
//                    break
//
//                    case 'es':
//                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/es/volumio";
//                    break
//
//                    default:
//                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/en/volumio";
//                    break
//
//
//                }
                uiconf.sections[0].description=self.getI18n("BAUERRADIO.ACCOUNT_LOGIN_DESC");
                uiconf.sections[0].saveButton.label=self.getI18n("COMMON.LOGIN");
                uiconf.sections[0].onSave.method="saveAccountCredentials";
            }
            // Status section (uiconf.sections[1])
            let status = '';
            if (self.state.status === 'play') {
                status = 'Monitoring currently playing station';
                if (bRadio.realTimeNowPlaying()) status += ' using realtime Now Playing URL.'
                else status += ' using mpd status info.'
            }
            else status = 'Not playing right now.';
            uiconf.sections[1].description=status;
            
            let stationsStats = bRadio.getStationsStats();  
            uiconf.sections[1].content[0].label = 'Number of stations: ' + stationsStats.total;
            if (stationsStats.premium) {
                uiconf.sections[1].content[1].label = 'Of Which Premium Only: ' + stationsStats.premium;
                uiconf.sections[1].content[1].hidden=false;
            }
            else uiconf.sections[1].content[1].hidden=true;
            uiconf.sections[1].content[2].label = 'Number of brands:   ' + stationsStats.brands;
            uiconf.sections[1].content[3].label = 'Last list refresh:  ' + new Date(stationsStats.updated).toLocaleString('en-GB', { dateStyle : "short", timeStyle : "short"});
            
            // Debug section (uiconf.sections[2])
            uiconf.sections[2].content[0].value = self.debug;
            defer.resolve(uiconf);
        })
        .fail(function(e)
        {
            self.logger.error('Could not fetch BauerRadio UI Configuration: ' + e);
            defer.reject(new Error());
        });

    return defer.promise;
};

ControllerBauerRadio.prototype.saveAccountCredentials = function (settings) {
    var self=this;
    var defer=libQ.defer();

    bRadio.loginToBauerRadio(settings['username'], settings['password'])
        .then(()=>{
            this.userEmail = settings['username'];
            this.isLoggedIn = true;
            this.config.set('username', settings['username']);
            this.config.set('password',settings['password']);

//            self.commandRouter.pushToastMessage('success', self.getI18n('COMMON.LOGGED_IN'));
            self.rescanStations(true);
//            // update config page:
//            let config = self.getUIConfig();
//            config.then(function(conf) {
//                self.commandRouter.broadcastMessage('pushUiConfig', conf);
//            });
            defer.resolve({});
        })
        .fail(()=>{
            self.commandRouter.pushToastMessage('error', self.getI18n('COMMON.ERROR_LOGGING_IN'));
            defer.reject();
        });
    
    return defer.promise;
};

/**
* Update Debug Settings, changing the level of detailed logged
* 0 : only errors logged; for higher numbers increasingly more detail is logged
 * @param {type} data
 * @returns {.libQ@call;defer.promise} 
 */
 ControllerBauerRadio.prototype.updateDebugSettings = function (data)
{
	var self = this;
	var defer=libQ.defer();

    self.debug = parseInt(data['debugLevel']) || 0;
	self.config.set('debugLevel', self.debug);
	defer.resolve();
	
    self.commandRouter.pushToastMessage('success', "Saved settings", "Set debug level to " + self.debug);

	return defer.promise;
};

 ControllerBauerRadio.prototype.rescanStations = function (ui)
{
	var self = this;
	var defer=libQ.defer();

    bRadio.getLiveStations(true)
           .then((stations) =>  {
                self.commandRouter.pushToastMessage('success', "Live station list", "Successfully loaded " + stations.size + " stations.");
                
                if (ui) {
                    let config = self.getUIConfig();
                    config.then(function(conf) {
                        self.commandRouter.broadcastMessage('pushUiConfig', conf);
                    });
                }
                defer.resolve();
            })
            .fail(() => defer.reject());
	return defer.promise;
};
 
 
ControllerBauerRadio.prototype.clearAccountCredentials = function (settings) {
    var self=this;
    var defer=libQ.defer();

    self.logoutFromBauerRadio(settings['username'], settings['password'])
        .then(()=>{
            let config = self.getUIConfig();
            config.then(function(conf) {
                self.commandRouter.broadcastMessage('pushUiConfig', conf);
            });

            self.commandRouter.pushToastMessage('success', self.getI18n('COMMON.LOGGED_OUT'));
            self.rescanStations();
            defer.resolve({});
        })
        .fail(()=>{
            self.commandRouter.pushToastMessage('error', self.getI18n('COMMON.ERROR_LOGGING_OUT'));
            defer.reject();
        });
    
    return defer.promise;
}

ControllerBauerRadio.prototype.logoutFromBauerRadio=function(username, password) {

    this.config.set('username', "");
    this.config.set('password', "");
    this.isLoggedIn = false;
    this.userEmail = '';
    return libQ.resolve(bRadio.forgetCurrentUser());
};

ControllerBauerRadio.prototype.isLoggedIn = function () {
    return this.config.get("loggedin", false);
};

    
ControllerBauerRadio.prototype.pushState = function (state) {
    
    this.logger.info('[BauerRadio] PushState called');
};

ControllerBauerRadio.prototype.getState = function () {
    
    this.logger.info('[BauerRadio] getState called');
};
 
ControllerBauerRadio.prototype.pushSongState = function (metadata, status) {
    var self = this;
    let seek = 0;
    let ts = Date.now();
    
//    if (metadata.timestamp){
//        seek = (ts - metadata.timestamp * 1000);
//        ts = metadata.timestamp * 1000;
//    }
    
    var prState = {
        status: status,
        service: this.updateService,
//        type: 'webradio',
        trackType: self.currentStation.trackType,
//        radioType: 'bauerradio',
        albumart: metadata.albumart,
        title: metadata.title || '',  // make sure title is always a string
        artist: metadata.artist,
        album: metadata.album,
        streaming: true,
        duration: metadata.duration,
        seek: seek
    };

    if (status === 'start') prState.status = 'play';
    
    if (metadata.duration) this.songEndTime = ts + (metadata.duration + 5) * 1000;
    else this.songEndTime = bigTimeStamp;
    
    //workaround to allow state to be pushed when not in a volatile state
    var vState = self.commandRouter.stateMachine.getState();
    var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];

    queueItem.name =  metadata.title || '';
    queueItem.artist =  metadata.artist;
//    queueItem.album = metadata.album;
    queueItem.albumart = metadata.albumart; 
    queueItem.duration = metadata.duration;
      
    if (metadata.samplerate) { prState.samplerate = metadata.samplerate  + ' kHz'; queueItem.samplerate = prState.samplerate; }
    if (metadata.bitdepth) { prState.bitdepth = metadata.bitdepth; queueItem.bitdepth = metadata.bitdepth; }
    if (metadata.channels) { prState.channels = metadata.channels; queueItem.channels = metadata.channels; }

    if (self.debug > 2) self.logger.info('[BauerRadio] Current state: ' + vState.status + ', Queue position: ' + vState.position);

    if ((status === 'play') && (!metadata.noUpdate)) self.state = prState;
    
    //reset volumio internal timer
    self.commandRouter.stateMachine.currentSeek = seek;
    self.commandRouter.stateMachine.playbackStart=ts;
    self.commandRouter.stateMachine.currentSongDuration=metadata.duration;
    self.commandRouter.stateMachine.askedForPrefetch=false;
    self.commandRouter.stateMachine.prefetchDone=false;
    self.commandRouter.stateMachine.simulateStopStartDone=false;

    //volumio push state
//    self.commandRouter.servicePushState(prState, self.serviceName);
    self.commandRouter.servicePushState(prState, this.updateService);
    
    // Hack: for the first track Volumio does not seem to take this status (info: CoreStateMachine::syncState   stateService play, but currentStatus stop)
    // so resend data a second time, which seems to do the trick...
    if (status === 'start') self.commandRouter.servicePushState(prState, this.updateService);
};

ControllerBauerRadio.prototype.getMetadata = function () {
    var self = this;
    var defer = libQ.defer();    
    
    if (self.debug > 2) self.logger.info('[BauerRadio] getMetadata started');

        if (bRadio.realTimeNowPlaying()){
            bRadio.nowPlaying()
                .then(song => {
                    if (!song.title) {
                        this.logger.warn('[BauerRadio] Empty realtime now playing response. Something is going wrong here');
                        song = this.currentStation;
                    }
                    if ((song.title == this.state.title) && (song.artist == this.state.artist)) {
                        if (Date.now() > this.songEndTime) {
                            if (self.debug > 0) this.logger.info('[BauerRadio] Song should have ended by now: '+ this.commandRouter.stateMachine.currentSeek/1000);
                            bRadio.getStationNowPlayingInfo()
                                .then(np => {
                                    console.log(JSON.stringify(np))
                                    let stationEpisode = { noUpdate : true };
                                    if ((np.nowPlayingTrack && np.nowPlayingTrack !== this.state.title) && (np.nowPlayingArtist !== this.state.artist)) {
                                        // some shows do not seem to have now playing data on the premium channel, but only on the regular
                                        // version. In this case try to grab the now Playing info that has been returned by the station:
                                        stationEpisode.title = np.nowPlayingTrack;
                                        stationEpisode.artist = np.nowPlayingArtist;
                                        stationEpisode.albumart = np.nowPlayingImage;
                                        stationEpisode.duration = np.nowPlayingDuration;                            
                                    }
                                    else {
                                        // no now playing info available. Display the station name together with the show title:
                                        stationEpisode.title = this.currentStation.title + ' (' + np.episodeTitle + ')';
                                        stationEpisode.albumart = this.currentStation.albumart;
                                        stationEpisode.duration = (np.episodeEnd-Date.now())/1000;
                                    }
                                    defer.resolve(stationEpisode);
                            });
                        }
                        else defer.resolve({unchanged: true});
                    } else {
                        // get extra data directly from mpd
                        this.mpdPlugin.getState()
                            .then(mState => {
                                song.samplerate = mState.samplerate;
                                song.bitdepth = mState.bitdepth;
                                song.channels = mState.channels;
                                song.bitrate = mState.bitrate;
                                defer.resolve(song);
                            })
                            .fail(() => defer.resolve(song));
                    }
                });
        } else if (this.currentStation.type === 'listenagain') {
            let stationEpisode = { 
                noUpdate : false,
                title : this.currentStation.title,
                albumart : this.currentStation.albumart
            };
            
            if (this.playlist) {
                let i = 0;
                let playtime = Date.now() - this.currentStation.starttime;
                while (this.playlist[i]['starttime'] < playtime) i++;
                if (i > 0) {
                    i--;                
                    if ((this.playlist[i].title === this.state.title) && (this.playlist[i].artist === this.state.artist)) {
                        stationEpisode = {unchanged: true};
                    } else {
                        stationEpisode = this.playlist[i];
                    }    
                }
            } 
            defer.resolve(stationEpisode);
            
        } else {
            self.mpdPlugin.getState()
//            self.commandRouter.stateMachine.getState()
                .then(mState => {
                    if (self.currentSong == mState.title) {
                            defer.resolve({unchanged: true});
                    } else {
                        self.logger.info('[BauerRadio] mpd state ' + JSON.stringify(mState));
                        if (mState.title.startsWith('https://listenapi.planetradio.co.uk')){
                                if (self.debug > 0) self.logger.info('[BauerRadio] Try to retrieve metadata');
                                bRadio.getEventDetails(mState.title)
                                    .then(song => {
                                        self.currentSong = mState.title;
                                        song.samplerate = mState.samplerate;
                                        song.bitdepth = mState.bitdepth;
                                        song.channels = mState.channels;
                                        if (self.debug > 0) self.logger.info('[BauerRadio] metadata: ' + JSON.stringify(song));
                                        defer.resolve(song);
                                    });
                        } else {
                            mState.albumart = self.currentStation.albumart;
                            self.currentSong = mState.title;
                            if (mState.title.startsWith('playlist.m3u8')) mState.title = self.currentStation.name;
                            else {
                                if (mState.title.indexOf(compositeTitle.separator) > -1) { // Check if the title can be split into artist and actual title:
                                    try {
                                        let info = mState.title.split(compositeTitle.separator);
                                        mState.artist = info[compositeTitle.indexOfArtist].trim();
                                        mState.title = info[compositeTitle.indexOfTitle].trim();
                                        if (self.debug > 0) self.logger.info('[Bauerradio] Split composite title.');
                                   }
                                    catch (ex) {
                                       if (self.debug > 0) self.logger.info('[Bauerradio] Current track does not have sufficient metadata: Missing artist. Failed to split composite title ' + mState.title);
                                   }
                                } else {
                                    mState.albumart = self.currentStation.albumart;
                                    mState.title = self.currentStation.name;
                                }
                            }
                            defer.resolve(mState);
                        }
                    }
                })
//                .fail(defer.resolve(self.state));
        }    
//    }
    return defer.promise;
};

ControllerBauerRadio.prototype.setMetadata = function (playState) {
    let self = this;
    let defer = libQ.defer();
    
    if (playState === 'stop') {
        this.npTimer.clearInterval();
        defer.resolve(self.pushSongState(self.currentStation, playState));
    } 
    else {
        self.getMetadata()
            .then((metadata) => {
                if (self.debug > 1) self.logger.info('[BauerRadio] Metadata: ' + JSON.stringify(metadata));
                if (metadata){
                    if(metadata.unchanged) {
                        return defer.resolve();
                    }
                    else {
                        return defer.resolve(self.pushSongState(metadata, playState));
                    }
                };
            })
            .fail(() => {
                defer.reject('Failed to retrieve metadata.');
            });
    }
    return defer.promise;
};


ControllerBauerRadio.prototype.startNowPlayingTimer = function () {
    let self = this;
    let defer = libQ.defer();
    
    this.setMetadata('start')
            .then(() => {
                if (self.debug > 0) self.logger.info('[BauerRadio] Starting now playing timer with interval ' + nowPlayingRefresh/1000 + ' seconds.');
                this.npTimer.setInterval(self.setMetadata.bind(self), ['play'], npInterval);
            });
};


function PRTimer(callback, args, delay) {
    var start, remaining = delay;

    var nanoTimer = new NanoTimer();

    PRTimer.prototype.pause = function () {
        nanoTimer.clearTimeout();
        remaining -= new Date() - start;
    };

    PRTimer.prototype.resume = function () {
        start = new Date();
        nanoTimer.clearTimeout();
        nanoTimer.setTimeout(callback, args, remaining + 'm');
    };

    PRTimer.prototype.clear = function () {
        nanoTimer.clearTimeout();
    };

    this.resume();
};