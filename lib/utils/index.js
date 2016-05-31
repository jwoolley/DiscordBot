var Promise = require('bluebird');
var fs = require('fs');
var util = require('util');

module.exports = {
  node: util,
  fileExists: fileExists,
  readFile: readFile
};

function fileExists(path) {
  return new Promise(function (resolve, reject) {
    return fs.exists(path, function(exists) { 
      resolve(exists);
    });
  });
}

function readFile(path, encoding) {
  var encoding = encoding ? encoding : 'utf8';
  return new Promise(function (resolve, reject) {
    return fileExists(path)
      .then(exists => {
        if (!exists) {
          reject(new Error('Unable to read file ' + path + ': file doesn\'t exist'));
        }

        return fs.readFile(path, encoding, function(err, data) { 
          if (err) {
            reject(err);
          } else {
            try {
              var data = JSON.parse(data);             
              resolve(data);
            } catch (e)  {
              reject(e);
            }
          }
        });
      })
  });
}