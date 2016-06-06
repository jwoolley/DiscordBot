var mongodb = require('mongodb');
var Promise = require('bluebird');
var utils = require('./utils');

var MongoClient = mongodb.MongoClient;
  
function MongoDb(host, port, dbName) {
  this.config = Object.freeze({
    host: host,
    port: port,
    dbName: dbName
  });

  this.db = undefined;

  this.hasOpenConnection = false;
} 

MongoDb.prototype.open = function() {
  if (this.hasOpenConnection) {
    return Promise.resolve(this.db);
  }

  return new Promise((resolve, reject) => {
    var url = 'mongodb://' + this.config.host + ':' + this.config.port + '/' + this.config.dbName;

    MongoClient.connect(url, (err, db) => {
      if(err) {
        reject(new Error(err));
      } else {        
        this.db = db;

        db.on('close', () => {
          this.hasOpenConnection = false;
          console.log('database connection to ' + url + ' closed.');
        });

        db.on('timeout', () => {
          this.hasOpenConnection = false;
          console.log('database connection to ' + url + ' timed out.');
        });        

        process.on('SIGINT', function() {
            console.log('\nClosing mongodb connection.');            
            db.close();
            process.exit(0);
        });
        
        console.log('Connection established to ' + url);

        this.hasOpenConnection = true;

        resolve(this);
      }
    });
  });
}

MongoDb.prototype.close = function() {
  return this.db.close();
};

MongoDb.prototype.find = function(collection, query) {
  if (typeof collection === 'string') {
    collection = this.db.collection(collection);
  }

  return new Promise((resolve, reject) => {
    collection.find(query).toArray(function(err, result) {
      if (err) {
        reject(err);
      }
      resolve(result);
    });
  });
}

MongoDb.prototype.findOne = function(collection, query) {
  if (typeof collection === 'string') {
    collection = this.db.collection(collection);
  }

  return collection.findOne(query);
}

MongoDb.prototype.dumpTable = function(collection) {
  if (typeof collection === 'string') {
    collection = this.db.collection(collection);
  }
 
  return this.find(collection, null);
}

MongoDb.prototype.updateRow = function(collection, selector, update, shouldUpsert) {
  if (typeof collection === 'string') {
    collection = this.db.collection(collection);
  }
 
  return collection.updateOne(selector, { $set: update }, { upsert: shouldUpsert });
}

module.exports = MongoDb;