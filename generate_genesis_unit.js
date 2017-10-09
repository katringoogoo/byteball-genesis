/*jslint node: true */
"use strict";
var constants = require('byteballcore/constants.js');
var conf = require('./conf');
var fs = require('fs');
var objectHash = require('byteballcore/object_hash.js');   
var Mnemonic = require('bitcore-mnemonic');
var ecdsaSig = require('byteballcore/signature.js');
var validation = require('byteballcore/validation.js');

conf.hub = '';
conf.deviceName = '';

function usage() {
    console.error("\nusage: " + process.argv[0] + " " + process.argv[1] + " <path_to_genesis_config> <network_config_file> [-p]");
    process.exit(1);
}

if(process.argv.length < 4) {
    usage();
}

var genesisConfigFile = process.argv[2];
console.log("Using genesis config file: " + genesisConfigFile);

var outputNetworkConfigFile = process.argv[3];
console.log("Using output network config file: " + outputNetworkConfigFile);

var publish = false;
if(process.argv.length >= 5) {
    var arg = process.argv[4];
    if(arg === "-p") {
        console.log("PUBLISH MODE!");        
        publish = true;
    }
    else {
        console.log("Wrong argument: " + arg);
        usage();
    }
}


var genesisConfigData = {};
var networkConfig = {};
fs.readFile(genesisConfigFile, 'utf8', function(err, data) {
    // set global data
    genesisConfigData = JSON.parse(data);
    console.log("Read genesis input data: %j", genesisConfigData);

    if(publish === false) {
        generateGenesisUnit();
    }
    else {
        fs.readFile(outputNetworkConfigFile, 'utf8', function(err, data) {
            // set global data
            networkConfig = JSON.parse(data);
            console.log("Read genesis input data: %j", networkConfig);        
            publishGenesisUnit();
        });
    }
});

function writeNetworkConfigFile(genesis_unit_hash) {
    console.log("Writing network config file ...")
    
    var networkConfig = {
        witness_count: genesisConfigData.initial_witnesses.length,
        version: genesisConfigData.version,
        genesis_unit_hash: genesis_unit_hash,
        genesis_unit: genesisConfigData.unit,
        blackbytes_unit_hash: "<undefined>",
        initial_witnesses: genesisConfigData.initial_witnesses,
        initial_peers: genesisConfigData.initial_peers
    };

    fs.writeFile(outputNetworkConfigFile, JSON.stringify(networkConfig, null, '\t'), 'utf8', function(err) {
        if (err) {
            throw Error('failed to write ' + outputNetworkConfigFile + ': '+err);
        }
        process.exit(0);
    });
}

function onError(err) {
	throw Error(err);
}

function getConfEntryByAddress(address) {
    for (let entry of genesisConfigData.initial_witnesses_definition) {
        if(entry["address"] === address){
            return entry;
        }
    }
    return null;
}

function getDerivedKey(mnemonic_phrase, passphrase, account, is_change, address_index) {
    var mnemonic = new Mnemonic(mnemonic_phrase);
    var xPrivKey = mnemonic.toHDPrivateKey(passphrase);
    console.log(">> about to create signature with private key: " + xPrivKey);

    var path = "m/44'/0'/" + account + "'/"+is_change+"/"+address_index;
    var derivedPrivateKey = xPrivKey.derive(path).privateKey; 
    console.log(">> derived key: " + derivedPrivateKey);

    return derivedPrivateKey.bn.toBuffer({size:32});        // return as buffer
}

// signer that uses device address
var signer = {
    readSigningPaths: function(conn, address, handleLengthsBySigningPaths){
        handleLengthsBySigningPaths({r: constants.SIG_LENGTH});
    },
    readDefinition: function(conn, address, handleDefinition){
        var conf_entry = getConfEntryByAddress(address);
        // definition = JSON.parse(conf_entry["definition"]);
        var definition = conf_entry["definition"];        
        handleDefinition(null, definition);
    },
    sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
        var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
        var conf_entry = getConfEntryByAddress(address);
        var derivedPrivateKey = getDerivedKey(
            conf_entry["mnemonic_phrase"],
            conf_entry["passphrase"],
            0, 0, 0);
        handleSignature(null, ecdsaSig.sign(buf_to_sign, derivedPrivateKey));
    }
};

var validate = function(objJoint, onOk){
    var unit = objJoint.unit.unit;

    validation.validate(objJoint, {
        ifUnitError: onError,
        ifJointError: onError,
        ifTransientError: onError,
        ifNeedHashTree: function(){
            onError('need hash tree for unit '+unit);
        },
        ifNeedParentUnits: function(){
            onError('need parent units for unit '+unit);
        },
        ifOk: function(objValidationState, validation_unlock){
            onOk();
        },
        ifOkUnsigned: function(bSerial){
            onOk();
        }
    });
};


var onChangeError = function (change) {
    console.log("Change: " + change.toString());
    if(change > 0) {
        throw Error("Investigate - change should be negative/zero but is bigger than zero: " + change);
    }        
    generateGenesisUnit(Math.abs(change) + 1);
}
    
var onUnitOk = function (objJoint) {
    // setup genesis unit hash to pass validation
    constants.GENESIS_UNIT = objJoint.unit.unit;

    validate(objJoint, function() {
        console.log(">> Creation successful - hash: " + objJoint.unit.unit);
        writeNetworkConfigFile(objJoint.unit.unit);
    })
};


function generateGenesisUnit(change) {
    var composer = require('byteballcore/composer.js');
    composer.setGenesis(true);

    console.log(">> composing genesis unit");

    var payee_address = genesisConfigData.payout_address;
    console.log(">> payout address: " + payee_address);

    if(!change) {
        console.log(">> NO CHANGE, first pass ...");
    }
    else {
        console.log(">> FINAL PASS, creation cost is: " + change);        
    }

    var arrOutputs = [
        {address: genesisConfigData.initial_witnesses[0], amount: 0 }    // the change
    ];

    var remainingAmount = constants.TOTAL_WHITEBYTES;
    for (let witness of genesisConfigData.initial_witnesses) {
        for(var i=0; i<conf.witness_budget_count; ++i) {
            arrOutputs.push({address: witness, amount: conf.witness_budget});
            remainingAmount -= conf.witness_budget;
        }
    }
    if(change) {
        // if we got the change we need to subtract it from the reamining amount
        // this is the cost of the genesis creation
        remainingAmount -= change;
    }
    arrOutputs.push({address: payee_address, amount: remainingAmount});

    // optional text message
    var creation_message = genesisConfigData.creation_message;

    var genesisUnitInput = {
        paying_addresses: genesisConfigData.initial_witnesses,
        outputs: arrOutputs,
        signer: signer,
        callbacks: {
            ifNotEnoughFunds: onError,
            ifError: onError,
            ifChangeError: onChangeError,
            ifOk: onUnitOk
        },
        witnesses: genesisConfigData.initial_witnesses,
        messages: [{
            app: "text",
            payload_location: "inline",
            payload_hash: objectHash.getBase64Hash(creation_message),
            payload: creation_message
        }]    
    }

    console.log(">> Genesis Unit Input assembled: \n" + require('util').inspect(genesisUnitInput, {depth:null}));

    // save to global config data
    genesisConfigData.unit = JSON.parse(JSON.stringify(genesisUnitInput));

    composer.composeJoint(genesisUnitInput);
}

function publishGenesisUnit() {    
    conf.hub = networkConfig.initial_peers[0];
    var wss_hub = "wss://" + conf.hub;
    console.log(">> Setting up hub: " + conf.hub);

    var db = require('byteballcore/db.js');
    var storage = require('byteballcore/storage.js');
    var eventBus = require('byteballcore/event_bus.js');
    eventBus.on('connected', internalPublish);

    var network = require('byteballcore/network.js');
    network.addPeer(wss_hub);

    function internalPublish() {
        console.log(">> Got connected ...");

        var composer = require('byteballcore/composer.js');
        composer.setGenesis(true);
    
        var onUnitOk = function (objJoint) {
            // setup genesis unit hash to pass validation
            constants.GENESIS_UNIT = objJoint.unit.unit;
        
            validate(objJoint, function() {
                if (network.isConnected()) {
                    console.log(">> Genesis Unit validated - publishing ..." + objJoint.unit.unit);
                    network.broadcastJoint(objJoint);
                }            
            })
        };
    
        var genesisUnitInput = networkConfig.genesis_unit;
        console.log(">> Publishing Genesis Unit: \n" + require('util').inspect(genesisUnitInput, {depth:null}));
        genesisUnitInput.signer = signer;
        genesisUnitInput.callbacks = {
            ifNotEnoughFunds: onError,
            ifError: onError,
            ifChangeError: onChangeError,
            ifOk: onUnitOk
        };
        composer.composeJoint(genesisUnitInput);    
    }
}