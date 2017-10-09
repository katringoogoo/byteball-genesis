/*jslint node: true */
"use strict";
var generatePassword = require('password-generator');
var constants = require('constants');
var conf = require('./conf');
var fs = require('fs');

conf.hub = '';
conf.deviceName = '';

if(process.argv.length < 3) {
    console.error("usage: " + process.argv[0] + " " + process.argv[1] + " <wallet_name>");
    process.exit(1);
}

var wallet_name = process.argv[2];
var deviceName = wallet_name;
console.log(">> Generating wallet for: " + deviceName);

var config = {
    deviceName: deviceName,
    passphrase: generatePassword(16, true),
    emitReady: false,
    generate: true
}

var headlessWallet = require('headless-byteball');

conf.deviceName = config.deviceName;

headlessWallet.initialize(function (mnemonic_phrase, passphrase, definition, address, appDataDir) {
    var finishedConfig = {
        mnemonic_phrase: mnemonic_phrase,
        passphrase: passphrase,
        definition: definition,
        address: address,
        deviceName: deviceName,
        appDataDir: appDataDir
    };
    console.log(">> Config: %j", finishedConfig);
    fs.writeFile(deviceName + ".json", JSON.stringify(finishedConfig, null, '\t'), 'utf8', function(err){
        if (err) {
            console.log(err);
        }
        console.log("DONE, exiting.")
        process.exit(0);
    });
}, config);
