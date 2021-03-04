const request = require('request-promise');
const json2yaml = require('json2yaml');
const models = require('../models/');

let token = null;

async function authenticate(conf) {

    if(token && token != '')
        return token;

    console.log('authenticate');

    let callResults = await request({
        uri: conf.f_portainer_api_url + "/auth",
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: {
            Username: conf.f_portainer_login,
            Password: conf.f_portainer_password
        },
        json: true // Automatically stringifies the body to JSON
    });

    // Full token
    token = "Bearer "+ callResults.jwt;
}

exports.generateStack = async (stackName, network, containerIP, databaseIP, image, dbImage) => {

    console.log("generateStack");

    let conf = await models.E_configuration.findOne({
        where: {
            id: 1
        }
    });

    await authenticate(conf);

    let composeContent = json2yaml.stringify({
        "version": "3.3",
        "services": {
            "nodea": {
                "container_name": stackName + "_app",
                "image": "nodeasoftware/nodea:" + image,
                "restart": "always",
                "links": [
                    "database:database"
                ],
                "networks": {
                    [network]: {
                        "ipv4_address": containerIP
                    }
                },
                "volumes": [
                    "app:/app",
                ],
                "environment": {
                    "NODEA_ENV": "studio",
                    "HOSTNAME": stackName + "-" + conf.f_studio_domain.replace(/\./g, "-"),
                    "PROTOCOL": "http",
                    "PORT": conf.f_default_env_port,
                    "AUTH": conf.f_default_env_auth,
                    "SUPPORT_CHAT": conf.f_default_env_support_chat,
                    "OPEN_SIGNUP": conf.f_default_env_open_signup,
                    "SUB_DOMAIN": stackName,
                    "DOMAIN_STUDIO": conf.f_studio_domain,
                    "DOMAIN_CLOUD": conf.f_cloud_domain,
                    "SERVER_IP": containerIP,
                    "DATABASE_IP": "database",
                    "DATABASE_USER": "nodea",
                    "DATABASE_PWD": "nodea",
                    "DATABASE_NAME": "nodea",
                    "PORTAINER_URL": conf.f_portainer_api_url,
                    "PORTAINER_LOGIN": conf.f_portainer_login,
                    "PORTAINER_PWD": conf.f_portainer_password,
                    "GITLAB_PROTOCOL": conf.f_gitlab_url,
                    "GITLAB_URL": conf.f_gitlab_url,
                    "GITLAB_SSHURL": "git@gitlab.nodea.studio",
                    "GITLAB_LOGIN": conf.f_gitlab_login,
                    "GITLAB_PRIVATE_TOKEN": conf.f_gitlab_private_token,
                    "MATTERMOST_API_URL": conf.f_default_env_chat_api_url,
                    "MATTERMOST_TEAM": conf.f_default_env_chat_team,
                    "MATTERMOST_SUPPORT_MEMBERS": conf.f_default_env_chat_support_members,
                    "MATTERMOST_LOGIN": conf.f_default_env_chat_login,
                    "MATTERMOST_PWD": conf.f_default_env_chat_pwd

                },
                "labels": [
                    "nodea=true", // Needed flag for studio manager
                    "traefik.enable=true",
                    "traefik.docker.network=" + network,
                    "traefik.http.routers." + stackName + ".rule=Host(`" + stackName + '.' + conf.f_studio_domain + "`)",
                    "traefik.http.routers." + stackName + ".entrypoints=websecure",
                    "traefik.http.services." + stackName + ".loadbalancer.server.port=1337",
                    "traefik.http.routers." + stackName + ".service=" + stackName + "",
                    "traefik.http.routers." + stackName + ".tls=true",
                    "traefik.http.routers." + stackName + ".tls.options=intermediate@file",
                    "traefik.http.routers." + stackName + ".middlewares=secure-headers@file"
                ]
            },
            "database": {
                "container_name": stackName + "_database",
                "image": dbImage,
                "restart": "always",
                "networks": {
                    [network]: {
                        "ipv4_address": databaseIP
                    }
                },
                "volumes": [
                    "db_data:/var/lib/mysql"
                ],
                "environment": {
                    "MYSQL_DATABASE": "nodea",
                    "MYSQL_USER": "nodea",
                    "MYSQL_PASSWORD": "nodea",
                    "MYSQL_ROOT_PASSWORD": "nodea",
                    "MYSQL_AIO": 0,
                    "PG_DATA": "/var/lib/postgresql/data/pgdata",
                    "POSTGRES_DB": "nodea",
                    "POSTGRES_USER": "nodea",
                    "POSTGRES_PASSWORD": "nodea",
                    "POSTGRES_ROOT_PASSWORD": "nodea"
                },
                "labels": [
                    "nodea=true" // Needed flag for studio manager
                ]
            }
        },
        "networks": {
            [network]: {
                "external": {
                    "name": network
                }
            }
        },
        "volumes": {
            "app": {},
            "db_data": {}
        }
    });

    let options = {
        uri: conf.f_portainer_api_url + "/stacks",
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token
        },
        qs: {
            type: 2, // Compose stack (1 is for swarm stack)
            method: "string", // Could be file or repository
            endpointId: 1
        },
        body: {
            "Name": stackName,
            "StackFileContent": composeContent
        },
        json: true // Automatically stringifies the body to JSON
    };

    console.log("CALL => Stack generation");
    let generateCall = await request.post(options);

    // Return generated stack
    return generateCall;
}

exports.getAvailabeImages = async () => {

    console.log("getAvailabeImages");

    let conf = await models.E_configuration.findOne({
        where: {
            id: 1
        }
    });

    await authenticate(conf);

    let allImages = await request({
        uri: conf.f_portainer_api_url + "/endpoints/1/docker/images/json",
        method: "GET",
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token
        },
        json: true
    });

    const imageArray = [];

    for (var i = 0; i < allImages.length; i++) {
        imageArray.push(...allImages[i].RepoTags);
    }

    return imageArray;
}

exports.getDockerhubImages = async () => {

    console.log("getDockerhubImages");

    let allImages = await request({
        uri: "https://hub.docker.com/v2/repositories/nodeasoftware/nodea/tags",
        method: "GET",
        json: true
    });

    return allImages.results.map(x => x.name);
}

exports.getNetworks = async () => {

    console.log("getNetworks");

    let conf = await models.E_configuration.findOne({
        where: {
            id: 1
        }
    });

    await authenticate(conf);

    let allNetworks = await request({
        uri: conf.f_portainer_api_url + "/endpoints/1/docker/networks",
        method: "GET",
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token
        },
        json: true
    });

    allNetworks = allNetworks.filter(x => x.Name.includes('proxy'));

    const networks = [];

    for (var i = 0; i < allNetworks.length; i++) {
        networks.push({
            name: allNetworks[i].Name,
            root_ip: allNetworks[i].IPAM.Config[0].Gateway.slice(0, -2)
        })
    }

    return networks;
}

exports.deleteStack = async (stackName) => {

    console.log("deleteStack");

    let conf = await models.E_configuration.findOne({
        where: {
            id: 1
        }
    });

    await authenticate(conf);

    // Getting stack to delete
    let stackList = await request({
        uri: conf.f_portainer_api_url + "/stacks",
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token
        },
        json: true // Automatically stringifies the body to JSON
    });

    // Looking for stack with given stackName
    stackList = stackList.filter(x =>x.Name == stackName);

    if(stackList.length == 0)
        throw new Error("Unable to find the stack "+stackName+" on portainer.")

    await request.delete({
        uri: conf.f_portainer_api_url + "/stacks/"+stackList[0].Id,
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token
        },
        json: true // Automatically stringifies the body to JSON
    });

    let allVolumes = await request({
        uri: conf.f_portainer_api_url + "/endpoints/1/docker/volumes",
        method: "GET",
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': token
        },
        json: true
    });

    let promises = [];

    // Deleting linked volumes
    let volume;
    for (var i = 0; i < allVolumes.Volumes.length; i++) {
        volume = allVolumes.Volumes[i];
        if(volume.Name.indexOf(stackName + "_workspace") != -1 || volume.Name.indexOf(stackName + "_database") != -1){
            promises.push(request({
                uri: conf.f_portainer_api_url + "/endpoints/1/docker/volumes/"+volume.Name,
                method: "DELETE",
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'Authorization': token
                },
                json: true
            }));
        }
    }

    await Promise.all(promises);

    return ;
}