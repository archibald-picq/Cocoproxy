# Cocoproxy
Relay for home automation physical devices that provide Websocket interface. It is designed to run on Raspberry Pi connected to a wired i2c network of [Coconodes](https://github.com/archibald-picq/Coconode).

# Installation
Classic: `npm install`

The app is based on [kelly/node-i2c](https://github.com/kelly/node-i2c) for the i2c part. You should follow it's [tutorial](https://github.com/kelly/node-i2c#raspberry-pi-setup) to setup your Raspberry Pi to connect the i2c bus.

# Running
You can launch the relay manualy through this command to provide the websocket interface:
```
node proxy.js
```

The app is based on [expressjs](https://github.com/expressjs/express), so it can serve other files. You can append `--gui=` to provide your web interface.

```
node proxy.js --gui=../cocoweb/
```

# Install as a service
On recent system running systemd, you can use the provided file `.service` file :
```
cd cocoproxy/
sudo cp ./cocoproxy.service /etc/systemd/system/cocoproxy.service
sudo systemctl enable cocoproxy.service
sudo systemctl start cocoproxy.service
```

Then go to [http://pi:8080](http://pi:8080).

