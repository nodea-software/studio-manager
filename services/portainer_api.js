const request = require('request-promise');
const json2yaml = require('json2yaml');
const moment = require('moment');
const models = require('../models/');

let token = null;
let tokenDate = moment();

async function authenticate(conf) {

    // Refresh token every 60min
    if(token && token != '' && moment().diff(tokenDate, 'minutes') <= 60)
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
            Password: __cryptr.decrypt(conf.f_portainer_password)
        },
        json: true // Automatically stringifies the body to JSON
    });

    tokenDate = moment();

    // Full token
    token = "Bearer "+ callResults.jwt;
}

exports.generateStack = async (body) => {

    console.log("generateStack");

    const stackName = body.f_name;
    const network = body.network;
    const containerIP = body.f_container_ip;
    const databaseIP = body.f_database_ip;
    const image = body.f_image;
    const dbImage = body.f_db_image;

    let conf = await models.E_configuration.findOne({
        where: {
            id: 1
        }
    });

    await authenticate(conf);

    const environment = {
        "NODEA_ENV": "studio",
        "HOSTNAME": stackName + "-" + conf.f_studio_domain.replace(/\./g, "-"),
        "PROTOCOL": "http",
        "PORT": body.f_port,
        "AUTH": body.f_auth,
        "SUPPORT_CHAT": body.f_support_chat,
        "OPEN_SIGNUP": body.f_open_signup,
        "SUB_DOMAIN": stackName,
        "DOMAIN_STUDIO": conf.f_studio_domain,
        "DOMAIN_CLOUD": conf.f_cloud_domain,
        "SERVER_IP": containerIP,
        "DATABASE_IP": "database",
        "DATABASE_USER": "nodea",
        "DATABASE_PWD": "nodea",
        "DATABASE_NAME": "nodea",
        "MAIL_HOST": body.f_mail_host,
        "MAIL_PORT": body.f_mail_port,
        "MAIL_USER": body.f_mail_user,
        "MAIL_PWD": (body.f_mail_pwd && body.f_mail_pwd != '') ? body.f_mail_pwd : (conf.f_default_mail_pwd ? __cryptr.decrypt(conf.f_default_mail_pwd) : ''),
        "MAIL_FROM": body.f_mail_from,
        "MAIL_ENV_HOST": body.f_mail_env_host,
        "PORTAINER_URL": conf.f_portainer_api_url,
        "PORTAINER_LOGIN": conf.f_portainer_login,
        "PORTAINER_PWD": __cryptr.decrypt(conf.f_portainer_password),
        "GITLAB_PROTOCOL": conf.f_gitlab_protocol,
        "GITLAB_URL": conf.f_gitlab_url,
        "GITLAB_SSHURL": "git@gitlab.nodea.studio",
        "GITLAB_LOGIN": conf.f_gitlab_login,
        "GITLAB_PRIVATE_TOKEN": __cryptr.decrypt(conf.f_gitlab_private_token),
        "MATTERMOST_API_URL": body.f_chat_api_url,
        "MATTERMOST_TEAM": body.f_chat_team,
        "MATTERMOST_SUPPORT_MEMBERS": body.f_chat_support_members,
        "MATTERMOST_LOGIN": body.f_chat_login,
        "MATTERMOST_PWD": (body.f_chat_pwd && body.f_chat_pwd != '') ? body.f_chat_pwd : (conf.f_default_env_chat_pwd ? __cryptr.decrypt(conf.f_default_env_chat_pwd) : '')
    };

    // Need to parse every $ to avoid compose yml error: https://github.com/docker/compose/issues/4485
    for(const item in environment)
        if(typeof environment[item] === 'string' && environment[item].includes('$'))
            environment[item] = environment[item].replace(/\$/g, "$$$$");

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
                    "~/dockside/traefik/conf/dynamic:/app/workspace/rules"
                ],
                "environment": environment,
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

    let allImages = await request({
        uri: "https://hub.docker.com/v2/repositories/nodeasoftware/nodea/tags",
        method: "GET",
        json: true
    });

    return allImages.results.map(x => x.name);
}

exports.getNetworks = async () => {

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

        // Remove default proxy network from available network
        // Nodea env should be created on different docker network like proxy2
        if(allNetworks[i].Name == 'proxy')
            continue;

        networks.push({
            name: allNetworks[i].Name,
            root_ip: allNetworks[i].IPAM.Config[0].Gateway.slice(0, -2)
        })
    }

    return networks;
}

// exports.deleteStack = async (stackName) => {

//     console.log("deleteStack");

//     let conf = await models.E_configuration.findOne({
//         where: {
//             id: 1
//         }
//     });

//     await authenticate(conf);

//     // Getting stack to delete
//     let stackList = await request({
//         uri: conf.f_portainer_api_url + "/stacks",
//         method: 'GET',
//         headers: {
//             'Content-Type': 'application/json',
//             'Authorization': token
//         },
//         json: true // Automatically stringifies the body to JSON
//     });

//     // Looking for stack with given stackName
//     stackList = stackList.filter(x =>x.Name == stackName);

//     if(stackList.length == 0)
//         throw new Error("Unable to find the stack "+stackName+" on portainer.")

//     await request.delete({
//         uri: conf.f_portainer_api_url + "/stacks/"+stackList[0].Id,
//         headers: {
//             'Content-Type': 'multipart/form-data',
//             'Authorization': token
//         },
//         json: true // Automatically stringifies the body to JSON
//     });

//     let allVolumes = await request({
//         uri: conf.f_portainer_api_url + "/endpoints/1/docker/volumes",
//         method: "GET",
//         headers: {
//             'Content-Type': 'multipart/form-data',
//             'Authorization': token
//         },
//         json: true
//     });

//     let promises = [];

//     // Deleting linked volumes
//     let volume;
//     for (var i = 0; i < allVolumes.Volumes.length; i++) {
//         volume = allVolumes.Volumes[i];
//         if(volume.Name.indexOf(stackName + "_workspace") != -1 || volume.Name.indexOf(stackName + "_database") != -1){
//             promises.push(request({
//                 uri: conf.f_portainer_api_url + "/endpoints/1/docker/volumes/"+volume.Name,
//                 method: "DELETE",
//                 headers: {
//                     'Content-Type': 'multipart/form-data',
//                     'Authorization': token
//                 },
//                 json: true
//             }));
//         }
//     }

//     await Promise.all(promises);

//     return ;
// }