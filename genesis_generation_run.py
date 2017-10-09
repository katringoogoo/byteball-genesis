#!/usr/bin/env python

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys


class ConfigKeys(object):
    DEVICE_NAME = "deviceName"
    MNEMONIC_PHRASE = "mnemonic_phrase"
    PASSPHRASE = "passphrase"
    ADDRESS = "address"
    DEFINITION = "definition"


def abort_program():
    logging.error("Aborting")
    sys.exit(1)


def generate_wallet(wallet_name, staging_folder, move_appdata=True):
    """ Generate a new wallet.

    :param str wallet_name:
    :param str staging_folder:
    :param bool move_appdata:   If move is on the appdata configuration will be moved to the staging folder
                                else the configuration will only be copied to the staging folder
                                The generated json config file will always be moved to staging
    :return:                    Read in configuration
    :rtype:                     dict
    """
    run_node_script("_generate_wallet_config.js", wallet_name)

    config_name = wallet_name + ".json"
    if not os.path.exists(config_name):
        logging.error("Could not find config file: %s", config_name)
        abort_program()

    with open(config_name) as json_data:
        configuration_dict = json.load(json_data)

    app_data_dir = configuration_dict["appDataDir"]
    if move_appdata is True:
        shutil.move(app_data_dir, os.path.join(staging_folder, wallet_name))
    else:
        shutil.copy(app_data_dir, os.path.join(staging_folder, wallet_name))
    shutil.move(config_name, staging_folder)
    return configuration_dict


def run_node_script(node_script, *params):
    command = ["node", node_script]
    command.extend(params)
    process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE)
    process.wait()
    if process.stdout:
        for line in process.stdout:
            logging.debug("JS|> " + line.strip())
    if process.returncode != 0 and process.stderr:
        for line in process.stderr:
            logging.error("JS|> " + line.strip())
        abort_program()


def generate_network_config(config_file_path, network_config_file_path):
    logging.info("Generating genesis unit hash and network configuration ...")
    run_node_script("generate_genesis_unit.js", config_file_path, network_config_file_path)


def write_configuration(configurations, witness_name_prefix, genesis_wallet_name,
                        network_version, initial_peers, creation_message,
                        genesis_config_json_file):
    logging.info("Transforming configuration ...")

    witness_addresses = []
    witness_definition = []
    for config_name, config in configurations.items():
        if not config_name.startswith(witness_name_prefix):
            continue
        witness_addresses.append(config[ConfigKeys.ADDRESS])
        witness_definition.append({
            ConfigKeys.ADDRESS: config[ConfigKeys.ADDRESS],
            ConfigKeys.DEFINITION: config[ConfigKeys.DEFINITION],
            ConfigKeys.PASSPHRASE: config[ConfigKeys.PASSPHRASE],
            ConfigKeys.MNEMONIC_PHRASE: config[ConfigKeys.MNEMONIC_PHRASE]
        })

    # sort witness_addresses
    witness_addresses = sorted(witness_addresses, key=lambda x: x.upper())

    output_dict = {
        "payout_address": configurations[genesis_wallet_name][ConfigKeys.ADDRESS],
        "initial_witnesses": witness_addresses,
        "initial_witnesses_definition": witness_definition,
        "version": network_version,
        "initial_peers": initial_peers,
        "creation_message": creation_message
    }

    logging.info("Writing configuration file to: %s", genesis_config_json_file)
    with open(genesis_config_json_file, "w") as config_file:
        json.dump(output_dict, config_file, indent=4, ensure_ascii=False)


def create_genesis_configuration(staging_folder, witness_count, network_version, main_hub,
                                 creation_message):
    witness_name_prefix = "witness_"
    genesis_wallet_name = "genesis_wallet"
    genesis_input_data_filename = "genesis_input_data.json"
    network_config_filename = "network_config.json"

    if os.path.exists(staging_folder):
        logging.info("Removing old staging folder: %s", staging_folder)
        shutil.rmtree(staging_folder)

    all_configs = {}
    for index in range(1, witness_count + 1):
        name = witness_name_prefix + str(index)
        logging.info("Generating witness: %s", name)
        all_configs[name] = generate_wallet(name, staging_folder)

    logging.info("Generating genesis wallet")
    all_configs[genesis_wallet_name] = generate_wallet(genesis_wallet_name, staging_folder)

    genesis_input_data_path = os.path.join(staging_folder, genesis_input_data_filename)
    write_configuration(all_configs, witness_name_prefix, genesis_wallet_name,
                        network_version, [main_hub], creation_message,
                        genesis_input_data_path)

    network_config_file_path = os.path.join(staging_folder, network_config_filename)
    generate_network_config(genesis_input_data_path, network_config_file_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Witnesses and Genesis Unit",
                                     formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("-wc", "--witness-count", type=int, default=1,
                        help="Count of witnesses to generate")
    parser.add_argument("-s", "--staging-folder", type=str, default="../docker-images/_staging")
    parser.add_argument("-nv", "--network-version", type=str, default="1.0t")
    parser.add_argument("-m", "--main-hub", type=str, default="example.org/bb")
    parser.add_argument("-v", "--verbose", action='store_true')
    parser.add_argument("-msg", "--creation-message", type=str, default="Yvan eht Nioj!")
    args = parser.parse_args()

    if args.verbose is True:
        logging.getLogger().setLevel(logging.DEBUG)
        logging.info("VERBOSE logging enabled!")
    else:
        logging.getLogger().setLevel(logging.INFO)

    create_genesis_configuration(args.staging_folder, args.witness_count, args.network_version, args.main_hub,
                                 args.creation_message)
