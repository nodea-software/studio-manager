const models = require('../models/');
const request = require('request-promise');

let token = null;

async function authenticate(conf) {

    if(token && token != '')
        return token;

    console.log('authenticate CRON');

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
    token = "Bearer " + callResults.jwt;
    return token;
}

module.exports = () => {
	(async () => {

		let conf = await models.E_configuration.findOne({
			where: {
				id: 1
			}
		});

		if(!conf.f_portainer_api_url || conf.f_portainer_api_url == '')
			return;

		await authenticate(conf);

		let allContainers = await request({
		    uri: conf.f_portainer_api_url + "/endpoints/1/docker/containers/json",
		    method: "GET",
		    headers: {
			    'Content-Type': 'multipart/form-data',
			    'Authorization': token
			},
	    	json: true
		});

		// Filter container other that nodea
		allContainers = allContainers.filter(x => {
			return x.Labels['nodea'] == "true";
		});

		// Looking for our container ID
		let stack, stacksDone = [], containers, ipAdresses, environment, url = "";
		for (var i = 0; i < allContainers.length; i++) {

			stack = allContainers[i].Labels['com.docker.compose.project'];

			if(typeof stack !== "undefined" && stack != "traefik" && stack != "studio-manager" && stacksDone.indexOf(stack) == -1){

				containers = allContainers.filter(x => {
					return x.Labels['com.docker.compose.project'] == stack
				});

				ipAdresses = {
					container: "",
					database: ""
				}

				containers.map(x => {
					if(x.Names[0].indexOf("database") != -1){
						// Nodea database
						ipAdresses.database = x.NetworkSettings.Networks[x.HostConfig.NetworkMode].IPAddress
						return true;
					} else {
						// Nodea container
						ipAdresses.container = x.NetworkSettings.Networks[x.HostConfig.NetworkMode].IPAddress;
						url = x.Labels["traefik.http.routers." + stack + ".rule"].split("Host(`")[1].slice(0, -2)
						return true;
					}
				});

				if(url == '')
					continue;

				environment = await models.E_environment.findOne({
					where : {
						f_name: stack
					}
				});

				if(!environment)
					await models.E_environment.create({
						f_name: stack,
						f_container_ip: ipAdresses.container,
						f_database_ip: ipAdresses.database,
						f_url: "https://" + url
					})
				else
					await environment.update({
						f_container_ip: ipAdresses.container,
						f_database_ip: ipAdresses.database,
						f_url: "https://" + url
					})

				stacksDone.push(stack)
			}

		}

		// Clean stack that do no exist anymore
		let environments = await models.E_environment.findAll();

		for (env of environments)
			if(stacksDone.indexOf(env.f_name) == -1)
				await env.destroy();

		return;
	})().then(_ => {
		return true;
	}).catch(err => {
		console.error("ERROR WHILE UPDATING ENVIRONMENT LIST");
		console.error(err.message);
	})
};