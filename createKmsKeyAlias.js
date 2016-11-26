'use strict';

function createKmsKeyAlias(properties, callback) {
  if (typeof properties.AliasName === 'undefined') {
    return callback(new Error('The AliasName property was not specified.'));
  }

  if (typeof properties.TargetKeyId === 'undefined') {
    return callback(new Error('The TargetKeyId property was not specified.'));
  }

  let aws = require('aws-sdk');
  let kms = new aws.KMS();

  let params = {
    AliasName: properties.AliasName,
    TargetKeyId: properties.TargetKeyId,
  };

  console.log('createKmsKeyAlias', properties, params);

  listAliases(kms, properties, function(err, alias) {
    if (err) {
      return callback(err);
    }

    if (alias) {
      let hasAlias = alias.AliasName === properties.AliasName;
      let hasTargetKey = alias.TargetKeyId === properties.TargetKeyId;

      if (hasAlias && hasTargetKey) {
        return callback(null, {
          AliasName: alias.AliasName,
          AliasArn: alias.AliasArn,
          TargetKeyId: alias.TargetKeyId
        });
      }

      kms.updateAlias(params, function(err, data) {
        console.log('updateAlias', err, data);
        if (err) {
          return callback(err);
        }
        listAliases(kms, properties, function(err, alias) {
          if (err) {
            return callback(err);
          }
          return callback(null, {
            AliasName: alias.AliasName,
            AliasArn: alias.AliasArn,
            TargetKeyId: alias.TargetKeyId
          });
        });
      });
    } else {
      kms.createAlias(params, function(err, data) {
        console.log('createAlias', err, data);
        if (err) {
          return callback(err);
        }
        listAliases(kms, properties, function(err, alias) {
          if (err) {
            return callback(err);
          }
          return callback(null, {
            AliasName: alias.AliasName,
            AliasArn: alias.AliasArn,
            TargetKeyId: alias.TargetKeyId
          });
        });
      });
    }
  });
}

function deleteKmsKeyAlias(properties, callback) {
  if (typeof properties.AliasName === 'undefined') {
    return callback(new Error('The AliasName property was not specified.'));
  }

  let aws = require('aws-sdk');
  let kms = new aws.KMS();

  let params = {
    AliasName: properties.AliasName,
  };

  console.log('deleteKmsKeyAlias', properties, params);

  listAliases(kms, properties, function(err, alias) {
    if (err) {
      return callback(err);
    }

    if (alias) {
      kms.deleteAlias(params, function(err, data) {
        console.log('deleteAlias', err, data);
        if (err) {
          return callback(err);
        }
        return callback(null, {
          AliasName: alias.AliasName,
          AliasArn: alias.AliasArn,
          TargetKeyId: alias.TargetKeyId
        });
      });
    }

    return callback(null, {});
  });
}

function listAliases(kms, properties, callback) {
  kms.listAliases({}, function(err, data) {
    if (err) {
      return callback(err);
    }
    console.log('listAliases', err, data);

    let matching = data.Aliases.filter(function(alias) {
      return alias.AliasName === properties.AliasName
    });

    console.log('listAliases', matching);

    return callback(null, matching[0]);
  });
}

exports.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      createKmsKeyAlias(event.ResourceProperties, function(err, data) {
        let status = err ? 'FAILED' : 'SUCCESS';
        return sendResponse(event, context, status, data, err);
      });
      break;
    case 'Delete':
      deleteKmsKeyAlias(event.ResourceProperties, function(err, data) {
        let status = err ? 'FAILED' : 'SUCCESS';
        return sendResponse(event, context, status, data, err);
      });
      break;
    default:
      return sendResponse(event, context, 'FAILED', null,
        new Error('Unknown event RequestType: ' + event.RequestType)
      );
  }
};

exports.createKmsKeyAlias = createKmsKeyAlias;
exports.deleteKmsKeyAlias = deleteKmsKeyAlias;

function sendResponse(event, context, status, data, err) {
  let reason = err ? err + '; ' : '';

  let responseBody = {
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: 'createKmsKeyAlias-' + event.ResourceProperties.AliasName,
    Status: status,
    Reason: reason + 'See details in the CloudWatch Log: ' + context.logStreamName,
    Data: data
  };

  console.log("RESPONSE BODY:\n", responseBody);

  let https = require('https');
  let url = require('url');

  let json = JSON.stringify(responseBody);
  let parsedUrl = url.parse(event.ResponseURL);

  let options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': json.length
    }
  };

  let request =
    https.request(options, function(response) {
      console.log('STATUS: ' + response.statusCode);
      console.log('HEADERS: ' + JSON.stringify(response.headers));
      context.done(null, data);
    });

  request.on('error', function(error) {
    console.log("sendResponse Error:\n", error);
    context.done(error);
  });

  request.write(json);
  request.end();
}

if (require.main === module) {
  let fs = require('fs');

  console.log('createKmsKeyAlias called directly.');

  if (process.argv.length < 3) {
    usageExit();
  }

  let properties = null;

  try {
    properties = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  } catch (error) {
    console.error('Invalid JSON: ', error);
    usageExit();
  }

  switch (properties.RequestType) {
    case 'Create':
    case 'Update':
      createKmsKeyAlias(properties, function(err, data) {
        console.log('Result: ', err, data);
      });
      break;
    case 'Delete':
      deleteKmsKeyAlias(properties, function(err, data) {
        console.log('Result: ', err, data);
      });
      break;
    default:
      console.log('Unknown event RequestType: ' + properties.RequestType);
      process.exit(1);
  }
}

function usageExit() {
  let path = require('path');
  console.log('Usage: ' + path.basename(process.argv[1]) + ' JSON file.');
  process.exit(1);
}
