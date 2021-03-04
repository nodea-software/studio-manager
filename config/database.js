var globalConf = require('./global');

var databaseConf = {
    develop: {
        host: '127.0.0.1',
        port: '3306',
        user: 'root',
        password: '2653',
        database: 'studio-manager',
        dialect: 'mysql'
    },
    cloud: {
        host: 'database',
        port: '3306',
        user: 'nodea',
        password: 'nodea',
        database: 'studio-manager',
        dialect: 'mysql'
    }
}

module.exports = databaseConf[globalConf.env];
