# Generate byteball genesis unit semi-automated

This project tries to auto generate a number of witnesses and use their data to forge a genesis unit. After the initial generation the configured genesis-unit and its hash is saved to a network configuration file. 

The second stage assumes that all the witnesses and a hub are getting setup with the data that was generated earlier - this phase is not covered in this project.

When the whole setup is running one can re-use the network configuration file to publish the genesis unit to the network.

 
## Generate network configuration

Use the python script to generate the network configuration (see its usage with `-h` for a list of all parameters). The script only requires a standard python 2.7 installation (might also work with python 3 but untested).

```
python generate_genesis_unit.py --witness-count 3 
                                --staging-folder staging_folder
                                --network-version 1.0t
                                --main-hub example.org/bb
                                --creation-message "I wanna rock!"
```

If everything is setup correctly this will generate a network configuration file named "network_config.json", the genesis input data config "genesis_input_data.json" as well as the wallet configurations. All of the files will be generated to the staging folder.

## Publish genesis unit

After the network has been setup correctly (hub and witnesses are running). The genesis unit can be published.

Use the the following script together with the genesis input data and the network configuration to do this. Dont forget to add the `-p` switch that enables publishing mode.

```
node generate_genesis_unit.js <genesis_input_data> <network_config> -p
```


## Necessary modifications headless-byteball

To be able to control the functions of the headless wallet and to not duplicate code the follwoing code passage had to be changed. Especially have a look at the new callback `onDone`. New config values are `conf.bAutoStartup`. 

```
function initialize(onDone, config) {
	if (conf.permanent_paring_secret) {
		db.query(
			"INSERT "+db.getIgnore()+" INTO pairing_secrets (pairing_secret, is_permanent, expiry_date) VALUES (?, 1, '2038-01-01')",
			[conf.permanent_paring_secret]
		);
	}

	setTimeout(function() {
		readKeys(function(mnemonic_phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey){
			var saveTempKeys = function(new_temp_key, new_prev_temp_key, onDone){
				writeKeys(mnemonic_phrase, new_temp_key, new_prev_temp_key, onDone);
			};
			var mnemonic = new Mnemonic(mnemonic_phrase);
			// global
			xPrivKey = mnemonic.toHDPrivateKey(passphrase);
			var devicePrivKey = xPrivKey.derive("m/1'").privateKey.bn.toBuffer({size:32});
			// read the id of the only wallet
			readSingleWallet(function(wallet){
				// global
				wallet_id = wallet;
				var device = require('byteballcore/device.js');
				device.setDevicePrivateKey(devicePrivKey);
				let my_device_address = device.getMyDeviceAddress();
				db.query("SELECT 1 FROM extended_pubkeys WHERE device_address=?", [my_device_address], function(rows){
					if (rows.length > 1)
						throw Error("more than 1 extended_pubkey?");
					if (rows.length === 0)
						return setTimeout(function(){
							console.log('passphrase is incorrect');
							process.exit(0);
						}, 1000);
					require('byteballcore/wallet.js'); // we don't need any of its functions but it listens for hub/* messages
					device.setTempKeys(deviceTempPrivKey, devicePrevTempPrivKey, saveTempKeys);
					device.setDeviceName(conf.deviceName);
					device.setDeviceHub(conf.hub);
					let my_device_pubkey = device.getMyDevicePubKey();
					console.log("====== my device address: "+my_device_address);
					console.log("====== my device pubkey: "+my_device_pubkey);
					if (conf.permanent_paring_secret)
						console.log("====== my pairing code: "+my_device_pubkey+"@"+conf.hub+"#"+conf.permanent_paring_secret);
					if (conf.bLight){
						var light_wallet = require('byteballcore/light_wallet.js');
						light_wallet.setLightVendorHost(conf.hub);
					}
					if (!config || config.emitReady === true) {
						eventBus.emit('headless_wallet_ready');
					}
					else {
						console.log("not emitting wallet ready signal.")
					}
					if(onDone) {
						readWalletAdressAndDefinition(function(address, definition){						
							onDone(mnemonic_phrase, passphrase, definition, address, appDataDir);
						});						
					}
					else {
					    setTimeout(replaceConsoleLog, 1000);
					}
				});
			});
		}, config);
	}, 1000);
}

if (conf.bAutoStartup) {
	initialize();
}

exports.initialize = initialize;
```

Another change was necessary to the `readKeys` function

```

function readKeys(onDone, config){
	console.log('-----------------------');
	if (conf.control_addresses)
		console.log("remote access allowed from devices: "+conf.control_addresses.join(', '));
	if (conf.payout_address)
		console.log("payouts allowed to address: "+conf.payout_address);
	console.log('-----------------------');
	fs.readFile(KEYS_FILENAME, 'utf8', function(err, data){
		var rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
			//terminal: true
		});
		if(config && config.generate === true) {
			if(!err) { // there is already a file
				throw Error("Configuration already existing - please remove: " + appDataDir);
			}

			var deviceName = config.deviceName;
			var passphrase = config.passphrase;
			var userConfFile = appDataDir + '/conf.json';
			fs.writeFile(userConfFile, JSON.stringify({deviceName: deviceName}, null, '\t'), 'utf8', function(err){
				if (err)
					throw Error('failed to write ' + userConfFile + ': '+err);

				var deviceTempPrivKey = crypto.randomBytes(32);
				var devicePrevTempPrivKey = crypto.randomBytes(32);

				var mnemonic = new Mnemonic(); // generates new mnemonic
				while (!Mnemonic.isValid(mnemonic.toString()))
					mnemonic = new Mnemonic();

				writeKeys(mnemonic.phrase, deviceTempPrivKey, devicePrevTempPrivKey, function(){
					console.log('keys created');
					var xPrivKey = mnemonic.toHDPrivateKey(passphrase);
					createWallet(xPrivKey, function(){
						onDone(mnemonic.phrase, passphrase, deviceTempPrivKey, devicePrevTempPrivKey);
					});
				});
			});
		}		
		if (err){ // first start
		...
```

A new function was added
```
function readWalletAdressAndDefinition(handleAddress){
	db.query("SELECT address, definition FROM my_addresses WHERE wallet=?", [wallet_id], function(rows){
		if (rows.length === 0)
			throw Error("no addresses");
		if (rows.length > 1)
			throw Error("more than 1 address");
		handleAddress(rows[0].address, JSON.parse(rows[0].definition));
	});
}
```

## Necessary modifications to byteballcore

In order to obtain the right amount of commission for the genesis unit the genesis unit generation works in two passes: the first pass generates the unit and calls (if present) the new `ifChangeError` returns the change that needs to be deduced from the sum of the outputs. This then leads to a second pass which generates the final genesis unit.

```
			// change, payload hash, signature, and unit hash
			var change = total_input - total_amount - objUnit.headers_commission - objUnit.payload_commission;
			if (change <= 0){
				if(callbacks.ifChangeError) {
					unlock_callback();					
					return callbacks.ifChangeError(change);
				}
				if (!params.send_all)
					throw Error("change="+change+", params="+JSON.stringify(params));
				return handleError({ 
					error_code: "NOT_ENOUGH_FUNDS", 
					error: "not enough spendable funds from "+arrPayingAddresses+" for fees"
				});
			}
```