var globalConf = require('../config/global');
var builder = require('../utils/model_builder');
var sms = require('../utils/sms_helper');
var fs = require('fs-extra');

var attributes_origin = require("./attributes/e_media_sms.json");
var associations = require("./options/e_media_sms.json");

module.exports = (sequelize, DataTypes) => {
    var attributes = builder.buildForModel(attributes_origin, DataTypes);
    var options = {
        tableName: '1_e_media_sms',
        timestamps: true
    };

    var Model = sequelize.define('E_media_sms', attributes, options);
    Model.associate = builder.buildAssociation('E_media_sms', associations);
    builder.addHooks(Model, 'e_media_sms', attributes_origin);

    // Return an array of all the field that need to be replaced by values. Array used to include what's needed for media execution
    //      Ex: ['r_project.r_ticket.f_name', 'r_user.r_children.r_parent.f_name', 'r_user.r_children.r_grandparent']
    Model.prototype.parseForInclude = function() {
        var valuesForInclude = [];
        var regex = new RegExp(/{field\|([^}]*)}/g), matches = null;
        while ((matches = regex.exec(this.f_message)) != null)
            valuesForInclude.push(matches[1]);

        var userRegex = new RegExp(/{(phone_field\|[^}]*)}/g);
        while ((match = userRegex.exec(this.f_targets)) != null) {
            var placeholderParts = match[1].split('|');
            var fieldPath = placeholderParts[placeholderParts.length-1];
            valuesForInclude.push(fieldPath);
        }

        return valuesForInclude;
    }

    Model.prototype.execute = function(resolve, reject, dataInstance) {
        var self = this;

        async function getGroupAndUserID() {
            property = 'f_phone_numbers';
            var userIds = [],
            	phoneNumbers = [];

            // EXTRACT GROUP USERS
            // Placeholder ex: {group|Admin|1}
            {
                var groupIds = [];
                // Exctract all group IDs from property to find them all at once
                var groupRegex = new RegExp(/{(group\|[^}]*)}/g);
                while ((match = groupRegex.exec(self[property])) != null) {
                    var placeholderParts = match[1].split('|');
                    var groupId = parseInt(placeholderParts[placeholderParts.length-1]);
                    groupIds.push(groupId);
                }

                // Fetch all groups found and their users
                var groups = await sequelize.models.E_group.findAll({
                    where: {id: {$in: groupIds}},
                    include: {model: sequelize.models.E_user, as: 'r_user'}
                });

                // Exctract email and build intermediateData object used to replace placeholders
                for (var i = 0; i < groups.length; i++)
                    for (var j = 0; j < groups[i].r_user.length; j++) {
                    	// Push user contact phone field. This is defined in conf/application.json
                        phoneNumbers.push(groups[i].r_user[j][globalConf.contact_field_for_sms]);
                    }
            }

            // EXTRACT USERS
            // Placeholder ex: {user|Jeremy|4}
            {
                // Exctract all user IDs from property to find them all at once
                var userRegex = new RegExp(/{(user\|[^}]*)}/g);
                while ((match = userRegex.exec(self[property])) != null) {
                    var placeholderParts = match[1].split('|');
                    var userId = parseInt(placeholderParts[placeholderParts.length-1]);
                    userIds.push(userId);
                }
            }

            // EXTRACT PHONE NUMBERS FROM PHONE FIELD TARGETED THROUGH RELATION
            // Placeholder ex: {phone_field|Field Label|r_parent.f_phone}
            {
                function findAndPushUserPhone(object, path, depth = 0) {
                    if (depth < path.length-1 && (!path[depth] || !object[path[depth]]))
                        return;
                    if (depth < path.length - 1)
                        return findAndPushUserPhone(object[path[depth]], path, ++depth);

                    // path[depth] is the field with the type phone we're looking for
                    var targetedEntity = object;
                    if (targetedEntity instanceof Array)
                        for (var i = 0; i < targetedEntity.length; i++)
                            phoneNumbers.push(targetedEntity[i][path[depth]]);
                    else
                        phoneNumbers.push(targetedEntity[path[depth]])
                }

                var userRegex = new RegExp(/{(phone_field\|[^}]*)}/g);
                while ((match = userRegex.exec(self[property])) != null) {
                    var placeholderParts = match[1].split('|');
                    var fieldPath = placeholderParts[placeholderParts.length-1];
                    // Dive in dataInstance to find targeted field
                    findAndPushUserPhone(dataInstance, fieldPath.split('.'));
                }
            }

            // Remove duplicate id from array
            userIds = userIds.filter(function(item, pos) {
                return userIds.indexOf(item) == pos;
            });
            // FETCH USERS
            // Push their contact phone field. This is defined in conf/application.json
            var users = await sequelize.models.E_user.findAll({where: {id: {$in: userIds}}});
            for (var i = 0; i < users.length; i++)
            	phoneNumbers.push(users[i][globalConf.contact_field_for_sms]);

            // Remove duplicate numbers and return
            return phoneNumbers.filter(function(item, pos) {
                return phoneNumbers.indexOf(item) == pos;
            });
        }

        function insertVariablesValue(property) {
            // Recursive function to dive into relations object until matching field or nothing is found
            function diveData(object, depths, idx) {
                if (!object[depths[idx]])
                    return "";
                else if (typeof object[depths[idx]] === 'object') {
                    if (object[depths[idx]] instanceof Date)
                        return moment(object[depths[idx]]).format("DD/MM/YYYY");
                    return diveData(object[depths[idx]], depths, ++idx);
                }
                else
                    return object[depths[idx]];
            }

            var newString = self[property];
            var regex = new RegExp(/{field\|([^}]*)}/g),
                matches = null;
            while ((matches = regex.exec(self[property])) != null)
                newString = newString.replace(matches[0], diveData(dataInstance, matches[1].split('.'), 0));

            self[property] = newString || "";
            return self[property];
        }

        // Replace {group|id} and {user|id} placeholders before inserting variables
        // to avoid trying to replace placeholders as entity's fields
        getGroupAndUserID().then(function(phoneNumbers) {
        	insertVariablesValue('f_message');

            // Send sms
            sms(phoneNumbers, self.f_message).then(resolve).catch(reject);
        });
    };

    return Model;
};