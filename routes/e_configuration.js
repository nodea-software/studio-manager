var express = require('express');
var router = express.Router();
var block_access = require('../utils/block_access');
// Datalist
var filterDataTable = require('../utils/filter_datatable');

// Sequelize
var models = require('../models/');
var attributes = require('../models/attributes/e_configuration');
var options = require('../models/options/e_configuration');
var model_builder = require('../utils/model_builder');
var entity_helper = require('../utils/entity_helper');
var file_helper = require('../utils/file_helper');
var status_helper = require('../utils/status_helper');
var component_helper = require('../utils/component_helper');
var globalConfig = require('../config/global');
var fs = require('fs-extra');
var dust = require('dustjs-linkedin');
var moment = require("moment");
var SELECT_PAGE_SIZE = 10;

// Enum and radio managment
var enums_radios = require('../utils/enum_radio.js');

router.get('/update_form', block_access.actionAccessMiddleware("configuration", "update"), function(req, res) {
    var id_e_configuration = 1;
    var data = {
        enum_radio: enums_radios.translated("e_configuration", req.session.lang_user, options)
    };

    entity_helper.optimizedFindOne('E_configuration', id_e_configuration, options).then(function(e_configuration) {
        if (!e_configuration) {
            data.error = 404;
            return res.render('common/error', data);
        }

        // Do not send password for security
        delete e_configuration.f_gitlab_private_token;
        delete e_configuration.f_portainer_password;
        delete e_configuration.f_cloud_portainer_password;
        delete e_configuration.f_default_env_chat_pwd;

        e_configuration.dataValues.enum_radio = data.enum_radio;
        data.e_configuration = e_configuration;

        res.render('e_configuration/update', data);

    }).catch(function(err) {
        entity_helper.error(err, req, res, "/", "e_configuration");
    })
});

router.post('/update', block_access.actionAccessMiddleware("configuration", "update"), function(req, res) {

    (async() => {
        var id_e_configuration = parseInt(req.body.id);

        if (typeof req.body.version !== "undefined" && req.body.version != null && !isNaN(req.body.version) && req.body.version != '')
            req.body.version = parseInt(req.body.version) + 1;
        else
            req.body.version = 0;

        var updateObject = model_builder.buildForRoute(attributes, options, req.body);

        if(!updateObject.f_gitlab_private_token || updateObject.f_gitlab_private_token == '')
            delete updateObject.f_gitlab_private_token;
        else
            updateObject.f_gitlab_private_token = __cryptr.encrypt(updateObject.f_gitlab_private_token);

        if(!updateObject.f_portainer_password || updateObject.f_portainer_password == '')
            delete updateObject.f_portainer_password;
        else
            updateObject.f_portainer_password = __cryptr.encrypt(updateObject.f_portainer_password);

        if(!updateObject.f_cloud_portainer_password || updateObject.f_cloud_portainer_password == '')
            delete updateObject.f_cloud_portainer_password;
        else
            updateObject.f_cloud_portainer_password = __cryptr.encrypt(updateObject.f_cloud_portainer_password);

        if(!updateObject.f_default_mail_pwd || updateObject.f_default_mail_pwd == '')
            delete updateObject.f_default_mail_pwd;
        else
            updateObject.f_default_mail_pwd = __cryptr.encrypt(updateObject.f_default_mail_pwd);

        if(!updateObject.f_default_env_chat_pwd || updateObject.f_default_env_chat_pwd == '')
            delete updateObject.f_default_env_chat_pwd;
        else
            updateObject.f_default_env_chat_pwd = __cryptr.encrypt(updateObject.f_default_env_chat_pwd);

        const e_configuration = await models.E_configuration.findOne({
            where: {
                id: id_e_configuration
            }
        })

        if (!e_configuration)
            throw new Error('404 - not found');

        component_helper.updateAddressIfComponentExist(e_configuration, options, req.body);

        await e_configuration.update(updateObject)

        // We have to find value in req.body that are linked to an hasMany or belongsToMany association
        // because those values are not updated for now
        await model_builder.setAssocationManyValues(e_configuration, req.body, updateObject, options)

    })().then(_ => {
        var redirect = '/configuration/update_form';
        req.session.toastr = [{
            message: 'message.update.success',
            level: "success"
        }];

        res.redirect(redirect);
    }).catch(err => {
        entity_helper.error(err, req, res, '/configuration/update_form', "e_configuration");
    })
});

module.exports = router;