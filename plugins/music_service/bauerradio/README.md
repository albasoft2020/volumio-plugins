## PlanetRadio (BauerRadio) Volumio plugin

This Volumio plugin provides more comprehensive access to PlanetRadio (BauerRadio) stations. If you have a BauerRadio premium account you can play extra premium live stations straight from Volumio.

### Development plan: 
- [x] Provide station browser which also list premium channels and can play them directly from the Volumio system
- [ ] Get more of the track metadata
- [ ] Provide some authentication/log in mechanism to log into a Bauer user account and set permission according to subscription levels
- [ ] Add catch-up (listen again) listings where available


### Credits:
- The actual plugin structure is lifted straight from the hotelradio Volumio plugin
- There seems to be no official documentation of how to interact with the Bauerradio API at all. Eventually I found a squeezebox plugin [Announce Planet Radio / Bauer Media plugin - PlanetRock, Absolute, Kiss, Scala ++](https://forums.slimdevices.com/showthread.php?114252-Announce-Planet-Radio-Bauer-Media-plugin-PlanetRock-Absolute-Kiss-Scala) developped by [Paul Webster](http://dabdig.blogspot.com/). The source code was very useful in figuring out at least some of the interactions...
