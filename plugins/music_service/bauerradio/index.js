'use strict'
var unirest=require('unirest');
var libQ=require('kew');
var ip = require('public-ip');
var fs=require('fs-extra');
var cron = require('node-schedule');
var moment=require('moment');
var NanoTimer = require('nanotimer');

var bRadio = require('./bauerRadio');  // BauerRadio specific code

var tokenExpirationTime;

const nowPlayingRefresh = 10000;  // time in ms

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
    
    this.previousSong = '';
    this.currentSong = '';
    this.state = {artist: '', title: ''};
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

    defer.resolve('');

    return defer.promise;
};

ControllerBauerRadio.prototype.onStart = function () {
    var defer=libQ.defer();

    this.loadI18n();
    this.startupLogin();
//    this.startRefreshCron();

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
    var self=this;

//    self.shallLogin()
//        .then(()=>self.loginToBauerRadio(this.config.get('username'), this.config.get('password'), false))
//        .then(()=>self.registerIPAddress())
//        .then(()=>self.addToBrowseSources())
    // HACK
    bRadio.setUserID(this.config.get("username"));
    self.addToBrowseSources();
};

ControllerBauerRadio.prototype.shallLogin = function () {
    var self=this;
    var defer=libQ.defer()

    if(this.config.get("loggedin",false) 
        && this.config.get("username")
        && this.config.get("username")!=""
        && this.config.get("password")
        && this.config.get("password")!="")
    {
        defer.resolve()
    } else 
    {
        defer.reject()
    }
    
    return defer.promise
};

ControllerBauerRadio.prototype.loginToBauerRadio=function(username, password) {
    var defer=libQ.defer()
    var self=this;

    self.logger.info('Loggin in to BauerRadio');

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
    defer.resolve();
    return defer.promise
}

ControllerBauerRadio.prototype.registerIPAddress=function() {
    var self=this
    var defer=libQ.defer()
    
    ip.v4().then((address)=>{
        var cookieJar=unirest.jar()
        cookieJar.add('PHPSESSID='+self.sessionId,'https://users.hotelradio.fm/api/user/updateip')

        var request=unirest.post('https://users.hotelradio.fm/api/user/updateip')
            .jar(cookieJar)
            .send('id='+self.userId)
            .send('ip='+address)
            .then((response)=>{
                if(response && 
                    response.status === 200 &&
                    'user' in response.body)
                {
                    defer.resolve()
                } else {
                    defer.reject()
                }   
            })
    }).catch((error)=>{
        defer.reject()
    })

    return defer.promise
}

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

    self.logger.info('Adding Bauer Radio to Browse Sources');
    var data = {name: 'BauerRadio.fm', uri: 'BauerRadio://',plugin_type:'music_service',plugin_name:'bauerradio',albumart:'/albumart?sectionimage=music_service/bauerradio/icons/PlanetRadio.svg'};
    self.logger.info('[BauerRadio] Adding browse source with: ' + data);
    return self.commandRouter.volumioAddToBrowseSources(data);
}

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
//            else return thishandleBrandBrowseUri(curUri);
        }
    }
};

ControllerBauerRadio.prototype.handleRootBrowseUri=function() {
    var defer=libQ.defer();
    var self=this;

//    var cookieJar = unirest.jar()
//    cookieJar.add('PHPSESSID=' + this.sessionId, 'https://users.hotelradio.fm/api/channelgroups/user')

//    var request = unirest.post('https://users.hotelradio.fm/api/channelgroups/user')
//        .jar(cookieJar)
//        .send('id=' + this.userId)
//        .then((response) => {
//            if (response &&
//                response.status === 200 &&
//                'channel_groups' in response.body) {
//                var groupItems = []
//                response.body['channel_groups'].map(group => {
//                    groupItems.push({
//                        "type": "item-no-menu",
//                        "title": group['group_name'],
//                        "albumart": group['group_cover'],
//                        "uri": `BauerRadio://${group['id']}`
//                    })
//                })
//
//                var browseResponse={
//                    "navigation": {
//                        "lists": [
//                            {
//                                "type": "title",
//                                "title": "TRANSLATE.BauerRadio.GROUPS",
//                                "availableListViews": [
//                                    "grid", "list"
//                                ],
//                                "items": groupItems
//                            }]
//                    }
//                }
//                self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);
//
//                defer.resolve(browseResponse)
//            } else {
//                defer.reject()
//            }
//        })

    var groupItems = [];
    
    groupItems.push({
        "type": "item-no-menu",
        "title": 'All Live Radio Stations',
        "albumart": '',
        "uri": 'BauerRadio://stations'
    });
    
    groupItems.push({
        "type": "item-no-menu",
        "title": 'Brands',
        "albumart": '/albumart?sectionimage=music_service/bauerradio/icons/PlanetRadio.svg',
        "uri": 'BauerRadio://brands'
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
                    "items": groupItems
                }]
        }
    }
    self.commandRouter.translateKeys(browseResponse, self.i18nStrings, self.i18nStringsDefaults);
    // fetch list of stations (if needed)
    bRadio.getLiveStations()
        .then((response) => {
            self.logger.info('[BauerRadio] Checked live station list. Number of stations found: ', response.size);
            defer.resolve(browseResponse);
        });
    return defer.promise;
};

ControllerBauerRadio.prototype.handleStationBrowseUri=function(curUri) {

    var defer=libQ.defer();
    var self=this;

//    var brandID=curUri.split('/')[2];
//    console.log(curUri, brandID);
    self.logger.info('[BauerRadio] handleStationBrowseUri called with: ' + curUri);
    
    var stationItems = [];
    
    bRadio.getLiveStations()
        .then((response) => {
//            console.log('Live stations found: ', response.size);

            response.forEach((value, key) => { 
                stationItems.push({
                    "type": "webradio",
                    "title": value['name'],
                    "albumart": value['albumart'],
                    "uri": `${curUri}/${key}`,
                    "service":"bauerradio"
                });
            });
//            console.log(stationItems[28]);
            
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

            self.logger.info('[BauerRadio] Listed live stations');
            defer.resolve(browseResponse);

        });
    return defer.promise;
};

ControllerBauerRadio.prototype.handleBrandBrowseUri=function(curUri) {

    var defer=libQ.defer();
    var self=this;

    self.logger.info('[BauerRadio] handleBrandBrowseUri called with: ' + curUri);
    
    var brandItems = [];
    
    bRadio.getBrands()
        .then((response) => {
//            console.log('Live stations found: ', response.size);

            response.forEach((value, key) => { 
                brandItems.push({
                    "type": "item-no-menu",
//                    "uri": 'BauerRadio://brands'
                    "title": value['name'],
                    "albumart": value['albumart'],
                    "uri": `${curUri}/${key}`,
//                    "service":"bauerradio"
                });
            });
            
//            console.log(stationItems[28]);
            
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

ControllerBauerRadio.prototype.handleBrandsStationsBrowseUri=function(curUri) {

    var defer=libQ.defer();
    var self=this;

    let brandID=curUri.split('/').pop(); // get last element of uri
    self.logger.info('[BauerRadio] handleStationBrowseUri called with: ' + curUri + ', i.e. brandID: ' + brandID);
    
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

            self.logger.info('[BauerRadio] Listed live stations');
            defer.resolve(browseResponse);

        });
    return defer.promise;
};

ControllerBauerRadio.prototype.explodeUri = function(curUri) {
    var defer=libQ.defer();
    var self=this;

    const stationID= curUri.split('/').pop();
    self.logger.info('[BauerRadio] explodeUri called with: ' + curUri + ', Ch: ' + stationID);

    let explodeResp =  {
                "uri": curUri,
                "service": "bauerradio",
                "name": "",
                "title": "Bauer Radio Station",
                "album": "",
                "type": "track",
                "albumart": ""
            };
    bRadio.getStationDetails(stationID)
        .then((response) => {
            explodeResp["name"] = response["name"];
            explodeResp["albumart"] = response["albumart"];
            defer.resolve([explodeResp]);
        });
    return defer.promise;
};

ControllerBauerRadio.prototype.getStreamUrl = function (curUri) {
    var defer=libQ.defer();
    var self=this;

//    var brandID=curUri.split('/')[2];
    let stationID = curUri.split('/').pop();

//    var cookieJar = unirest.jar()
//    cookieJar.add('PHPSESSID=' + this.sessionId, 'https://users.hotelradio.fm/api/channels/group')
//
//    var request = unirest.post('https://users.hotelradio.fm/api/channels/group')
//        .jar(cookieJar)
//        .send('id=' + brandID)
//        .then((response) => {
//            if (response &&
//                response.status === 200 &&
//                'channels' in response.body) {
//
//
//                var explodeResp = {
//                    "uri": ""
//                }
//                response.body['channels'].map(channel => {
//                    if(channel['id']==stationID)
//                    {
//                        if(channel["mp3128_stream_dir"] && channel['mp3128_stream_dir']!="")
//                        {
//                            explodeResp['uri']=channel['stream_path']+channel["mp3128_stream_dir"]
//                        }
//                        else if(channel['aacp_stream_dir'] && channel['aacp_stream_dir']!="")
//                        {
//                            explodeResp['uri']=channel['stream_path']+channel["aacp_stream_dir"]
//                        } 
//                        else {
//                            explodeResp['uri']=channel['stream_path']+channel["stream_dir"]
//                        }
//                        
//                    }
//                })
//
//                defer.resolve(explodeResp)
//            } else {
//                defer.reject()
//            }
//        })
    let explodeResp = {
        "uri": ""
    };
    bRadio.getStationDetails(stationID)
        .then((response) => {
            explodeResp["name"] = response["name"];
            explodeResp["uri"] = bRadio.getStreamUrl(stationID);
            self.logger.info('[BauerRadio] getStreamUrl returned: ' + explodeResp["uri"]);
            defer.resolve(explodeResp);
        });
    return defer.promise;
};

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
                .then(function(stream) {
                    return self.mpdPlugin.sendMpdCommand('load "'+track.uri+'"',[]);
                })
                .fail(function (e) {
                    return self.mpdPlugin.sendMpdCommand('add "'+track.uri+'"',[]);
                })
                .then(function() {
                    // try with 'consumeIgnoreMetadata' set to true
                    self.commandRouter.stateMachine.setConsumeUpdateService('mpd', true);
//                    self.commandRouter.stateMachine.setConsumeUpdateService(this.serviceName);
                    return self.mpdPlugin.sendMpdCommand('play',[]);
                })
                .then(() => setTimeout(self.setMetadata.bind(self), 1000, 'play'))
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

ControllerBauerRadio.prototype.stop = function() {
    var self = this;
    self.logger.info('[BauerRadio] Stopped playback');
    if (self.timer) {
        self.logger.info('[BauerRadio] Stopping timer');
        self.timer.clear();
    }
    return self.mpdPlugin.sendMpdCommand('stop', []);
};

ControllerBauerRadio.prototype.getUIConfig = function () {
    var self = this;

    var defer=libQ.defer();
    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+this.commandRouter.sharedVars.get('language_code')+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
            if (self.isLoggedIn()) {
                uiconf.sections[0].content[0].hidden=true;
                uiconf.sections[0].content[1].hidden=true;
                uiconf.sections[0].content[2].hidden=true;
                uiconf.sections[0].content[3].hidden=true;
                //uiconf.sections[0].content[4].hidden=false;
                
                uiconf.sections[0].description=self.getI18n("BauerRadio.LOGGED_IN_EMAIL")+self.userEmail;
                uiconf.sections[0].saveButton.label=self.getI18n("COMMON.LOGOUT")
                uiconf.sections[0].onSave.method="clearAccountCredentials"
            } else {
                uiconf.sections[0].content[0].hidden=false;
                uiconf.sections[0].content[1].hidden=false;
                uiconf.sections[0].content[2].hidden=false;
                uiconf.sections[0].content[3].hidden=true;
                //uiconf.sections[0].content[4].hidden=true;

                switch(self.commandRouter.sharedVars.get('language_code'))
                {
                    case 'de':
                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/volumio";
                    break

                    case 'it':
                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/it/volumio";
                    break

                    case 'fr':
                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/fr/volumio";
                    break

                    case 'es':
                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/es/volumio";
                    break

                    default:
                        uiconf.sections[0].content[0].onClick.performerUrl="https://hotelradio.fm/en/volumio";
                    break


                }
                

                uiconf.sections[0].description=self.getI18n("BAUERRADIO.ACCOUNT_LOGIN_DESC")
                uiconf.sections[0].saveButton.label=self.getI18n("COMMON.LOGIN")
                uiconf.sections[0].onSave.method="saveAccountCredentials"
            }

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

    self.loginToBauerRadio(settings['BauerRadio_username'], settings['BauerRadio_password'], 'user')
        .then(() => self.registerIPAddress())
        .then(() => self.addToBrowseSources())
        .then(()=>{
            this.config.set('username', settings['BauerRadio_username'])
            this.config.set('password',settings['BauerRadio_password'])

            var config = self.getUIConfig();
            config.then(function(conf) {
                self.commandRouter.broadcastMessage('pushUiConfig', conf);
            });

            self.commandRouter.pushToastMessage('success', self.getI18n('COMMON.LOGGED_IN'));
            defer.resolve({})
        })
        .fail(()=>{
            self.commandRouter.pushToastMessage('error', self.getI18n('COMMON.ERROR_LOGGING_IN'));
            defer.reject()
        })
    
    return defer.promise
}

ControllerBauerRadio.prototype.clearAccountCredentials = function (settings) {
    var self=this;
    var defer=libQ.defer();

    self.logoutFromBauerRadio(settings['BauerRadio_username'], settings['BauerRadio_password'])
        //.then(() => self.registerIPAddress())
        .then(() => self.commandRouter.volumioRemoveToBrowseSources('BauerRadio.fm'))
        .then(()=>{
            var config = self.getUIConfig();
            config.then(function(conf) {
                self.commandRouter.broadcastMessage('pushUiConfig', conf);
            })

            self.commandRouter.pushToastMessage('success', self.getI18n('COMMON.LOGGED_OUT'));
            defer.resolve({})
        })
        .fail(()=>{
            self.commandRouter.pushToastMessage('error', self.getI18n('COMMON.ERROR_LOGGING_OUT'));
            defer.reject()
        })
    
    return defer.promise
}

ControllerBauerRadio.prototype.logoutFromBauerRadio=function(username, password) {
    var defer=libQ.defer()
    var self=this

    unirest.post('https://users.hotelradio.fm/api/index/logout')
        .send('username='+username)
        .send('password='+password)
        .then((response)=>{
            if(response && 
                response.cookies && 
                'PHPSESSID' in response.cookies && 
                response.status === 200 &&
                response.body &&
                response.body.code == 200)
            {   
                this.config.set('username', "")
                this.config.set('password', "")
                this.config.set("loggedin", false)

                defer.resolve()
            } else {
                defer.reject()
            }   
        })

    return defer.promise;
};

ControllerBauerRadio.prototype.isLoggedIn = function () {
    return this.config.get("loggedin", false);
};

ControllerBauerRadio.prototype.startRefreshCron=function() {
    var self=this;

    this.stopRefreshCron();

    // Refreshing login every 12 hours
    var m=moment();
    var cronString=m.second()+' '+m.minute()+' '+m.hour()+','+(m.hour()+12)%24+' * * *';
    this.accessTokenRefreshCron=cron.scheduleJob(cronString, () => {
        self.startupLogin();
    });

    this.logger.info('AccessToken refresher cron started for Bauer Radio');
};

ControllerBauerRadio.prototype.stopRefreshCron=function() {
    if(this.accessTokenRefreshCron)
    {
        this.accessTokenRefreshCron.cancel()
        this.accessTokenRefreshCron=undefined
    }

    this.logger.info('Stopping AccessToken refresher cron for Bauer	Radio');
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
    
    if (metadata.timestamp){
        seek = (ts - metadata.timestamp * 1000);
        ts = metadata.timestamp * 1000;
    }
    
    var prState = {
        status: status,
//        service: self.serviceName,
        service: 'mpd',
//        type: 'webradio',
        trackType: 'aac',
//        radioType: 'bauerradio',
        albumart: metadata.albumart,
//        uri: flacUri,
//        name: metadata.title,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        streaming: true,
//        disableUiControls: true,
        duration: metadata.duration,
        seek: seek,
//        samplerate: '44.1 KHz',
//        bitdepth: '16 bit',
        channels: 2
    };

    self.state = prState;

    //workaround to allow state to be pushed when not in a volatile state
    var vState = self.commandRouter.stateMachine.getState();
    var queueItem = self.commandRouter.stateMachine.playQueue.arrayQueue[vState.position];

    queueItem.name =  metadata.title;
    queueItem.artist =  metadata.artist;
//    queueItem.album = metadata.album;
    queueItem.albumart = metadata.albumart;
//    queueItem.trackType = 'Rparadise '+ channelMix;
    queueItem.duration = metadata.duration;
//    queueItem.samplerate = '44.1 KHz';
//    queueItem.bitdepth = '16 bit';
//    queueItem.channels = 2;
    
    //reset volumio internal timer
    self.commandRouter.stateMachine.currentSeek = seek;
    self.commandRouter.stateMachine.playbackStart=ts;
    self.commandRouter.stateMachine.currentSongDuration=metadata.duration;
    self.commandRouter.stateMachine.askedForPrefetch=false;
    self.commandRouter.stateMachine.prefetchDone=false;
    self.commandRouter.stateMachine.simulateStopStartDone=false;

    //volumio push state
//    self.commandRouter.servicePushState(prState, self.serviceName);
    self.commandRouter.servicePushState(prState, 'mpd');
};

ControllerBauerRadio.prototype.getMetadata = function () {
    var self = this;
    var defer = libQ.defer();    
    
    self.logger.info('[BauerRadio] getMetadata started');
//    var vState = self.commandRouter.stateMachine.getState();
    
//    let mState = self.mpdPlugin.getState();
//    self.logger.info('[BauerRadio] mpd state ' + JSON.stringify(mState));
    
//    if ((mState.title == self.currentSong)){
//        defer.resolve({unchanged: true});
//    } else {
//        self.currentSong = mState.title;
        if (bRadio.realTimeNowPlaying()){
            bRadio.nowPlaying()
                .then(song => {
                    if ((song.title == self.state.title) && (song.artist == self.state.artist)) {
                        defer.resolve({unchanged: true});
                    } else {
                        defer.resolve(song);
                    }
                });
        } else {
            self.mpdPlugin.getState()
                .then(mState => {
                    self.logger.info('[BauerRadio] mpd state ' + JSON.stringify(mState));
                    if (mState.title.startsWith('https://listenapi.planetradio.co.uk')){
                        if (self.currentSong == mState.title) {
                            defer.resolve({unchanged: true});
                        } else {
                            self.logger.info('[BauerRadio] Try to retrieve metadata');
                            bRadio.getEventDetails(mState.title)
                                .then(song => {
                                    self.currentSong = mState.title;
                                    self.logger.info('[BauerRadio] metadata: ' + JSON.stringify(song));
                                    self.logger.info('[BauerRadio] Pass on metadata');
                                    defer.resolve(song);
                                });
                        }
                    } else {
                        if (mState.title.startsWith('playlist.m3u8')) mState.title = 'Default title';
                        defer.resolve(mState);
                    }
                })
//                .fail(defer.resolve(self.state));
        }    
//    }
    return defer.promise;
};

ControllerBauerRadio.prototype.setMetadata = function (playState) {
    let self = this;
    
    return self.getMetadata()
    .then(function(metadata) {
        self.logger.info('[BauerRadio] Metadata: ' + JSON.stringify(metadata));
        if (metadata){
            if(metadata.unchanged) {
                self.logger.info('[BauerRadio] setting new timer with duration of ' + nowPlayingRefresh/1000 + ' seconds.');
                if (playState == 'play') self.timer = new PRTimer(self.setMetadata.bind(self), [playState], nowPlayingRefresh);
                return;
            }
            else {
                return libQ.resolve(self.pushSongState(metadata, playState))
                .then(function () {
                    self.logger.info('[BauerRadio] setting new timer with duration of ' + nowPlayingRefresh/1000 + ' seconds.');
                    if (playState == 'play') self.timer = new PRTimer(self.setMetadata.bind(self), [playState], nowPlayingRefresh);
                });
            }
        };
    })
    .fail(() => {
        self.logger.info('[BauerRadio] Failed. Setting new timer with duration of ' + nowPlayingRefresh/1000 + ' seconds.');
        if (playState == 'play') self.timer = new PRTimer(self.setMetadata.bind(self), [playState], nowPlayingRefresh);
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