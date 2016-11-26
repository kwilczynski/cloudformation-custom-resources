'use strict';

function createZoneAssociation(properties, callback) {
  validateProperties(properties, function(err, properties) {
    if (err) {
      return callback(err);
    }

    let comment = null;
    if (typeof properties.Comment !== 'undefined') {
      comment = properties.Comment;
    }

    let wait = false;
    if (typeof properties.Wait !== 'undefined') {
      if (typeof toBoolean(properties.Wait) !== 'boolean') {
        return callback(new Error('The Wait property must be a boolean type.'));
      }
      wait = toBoolean(properties.Wait);
    }

    let aws = require('aws-sdk');
    let route53 = new aws.Route53();

    let params = {
      Id: properties.HostedZoneId
    };

    console.log('getHostedZone', params);

    route53.getHostedZone(params).promise()
      .then(function(data) {
        let zone = null;

        data.VPCs.forEach(function(vpc) {
          if (vpc.VPCId === properties.VpcId) {
            zone = data.HostedZone;
            return;
          }
        });

        return zone;
      })
      .then(function(zone) {
        let results = {
          Region: properties.Region,
          HostedZoneId: properties.HostedZoneId,
          VpcId: properties.VpcId
        };

        if (zone) {
          console.log('The VPC "' + properties.VpcId
            + '" is already associated with Hosted Zone "'
            + properties.HostedZoneId + '", nothing to do.');
          return callback(null, results);
        }

        let params = {
          HostedZoneId: properties.HostedZoneId,
          VPC: {
            VPCId: properties.VpcId,
            VPCRegion: properties.Region
          }
        };

        if (comment) {
          params.Comment = comment;
        }

        console.log('createZoneAssociation', properties, params);

        route53.associateVPCWithHostedZone(params, function(err, data) {
          console.log('associateVPCWithHostedZone', err, data);

          if (err) {
            throw err;
          }

          if (wait) {
            waitForCondition(1000, 30, function(condition) {
              let params = {
                Id: data.ChangeInfo.Id
              };

              console.log('getChange', params);

              route53.getChange(params, function(err, data) {
                if (err) {
                  throw err;
                }
                return condition(data.ChangeInfo.Status === 'INSYNC');
              });
            }, function(result) {
              if (result) {
                return callback(null, results);
              } else {
                throw new Error('Timed out waiting for VPC "'
                  + properties.VpcId + '" association to the Hosted Zone "'
                  + properties.HostedZoneId + '", aborting.');
              }
            });
          } else {
            return callback(null, results);
          }
        });
      })
      .catch(function(err) {
        return callback(err);
      });
  });
}

function deleteZoneAssociation(properties, callback) {
  validateProperties(properties, function(err, properties) {
    if (err) {
      return callback(err);
    }

    let aws = require('aws-sdk');
    let route53 = new aws.Route53();

    let params = {
      HostedZoneId: properties.HostedZoneId,
      VPC: {
        VPCId: properties.VpcId,
        VPCRegion: properties.Region
      }
    };

    console.log('deleteZoneAssociation', properties, params);

    route53.disassociateVPCFromHostedZone(params, function(err, data) {
      console.log('disassociateVPCFromHostedZone', err, data);

      if (err) {
        switch (err.code) {
          case 'NoSuchHostedZone':
            console.log('The Hosted Zone "' + properties.HostedZoneId
              + '" does not exist, nothing to do.');
            break;
          case 'VPCAssociationNotFound':
            console.log('The VPC "' + properties.VpcId
              + '" is not associated with Hosted Zone "'
              + properties.HostedZoneId + '", nothing to do.');
            break;
          case 'LastVPCAssociation':
            console.log('Unable to disassociate last VPC "' + properties.VpcId
              + '" from Hosted Zone "' + properties.HostedZoneId + '", nothing to do.');
            break;
          default:
            return callback(err);
        }
      }

      return callback(null, {
        Region: properties.Region,
        HostedZoneId: properties.HostedZoneId,
        VpcId: properties.VpcId
      });
    });
  });
}

function validateProperties(properties, callback) {
  if (typeof properties.HostedZoneId === 'undefined') {
    return callback(new Error('The HostedZoneId property was not specified.'));
  }

  if (typeof properties.VpcId === 'undefined') {
    return callback(new Error('The VpcId property was not specified.'));
  }

  let region = properties.InvokedFunctionRegion;

  if (typeof properties.Region === 'undefined') {
    properties.Region = region;
  }

  console.log('Region set to "' + properties.Region + '".');

  return callback(null, properties);
}

function toBoolean(value) {
  if (typeof value !== 'string') {
    return value;
  }

  switch (value.toLowerCase()) {
  case 'true':
    return true;
  case 'false':
    return false;
  default:
    return value;
  }
}

function waitForCondition(interval, times, condition, callback) {
  return (function check(i, last) {
    if (i == times) {
      callback(last);
    } else {
      setTimeout(function() {
        function done(result) {
          if (result) {
            callback(result);
          } else {
            check(i + 1, result);
          }
        }

        if (condition.length) {
          condition(done);
        } else {
          process.nextTick(function() {
            done(condition());
          });
        }
      }, interval);
    }
  })(0);
}

exports.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  let properties = event.ResourceProperties;

  properties.InvokedFunctionRegion =
    (function() {
      return (new RegExp(/lambda:(.+):\d/)).exec(context.invokedFunctionArn)[1];
    })();

  switch (event.RequestType) {
    case 'Create':
    case 'Update':
      createZoneAssociation(properties, function(err, data) {
        let status = err ? 'FAILED' : 'SUCCESS';
        return sendResponse(event, context, status, data, err);
      });
      break;
    case 'Delete':
      deleteZoneAssociation(properties, function(err, data) {
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

exports.createZoneAssociation = createZoneAssociation;
exports.deleteZoneAssociation = deleteZoneAssociation;

function sendResponse(event, context, status, data, err) {
  let reason = err ? err + '; ' : '';

  let responseBody = {
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: 'createRoute53ZoneAssociation-' + event.ResourceProperties.HostedZoneId,
    Status: status,
    Reason: reason + 'See details in CloudWatch Log: ' + context.logStreamName,
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

  console.log('createRoute53ZoneAssociation called directly.');

  if (process.argv.length < 3) {
    usageExit();
  }

  let properties = null;

  try {
    properties = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  } catch(error) {
    console.error('Invalid JSON: ', error);
    usageExit();
  }

  switch (properties.RequestType) {
    case 'Create':
    case 'Update':
      createZoneAssociation(properties, function(err, data) {
        console.log('Result: ', err, data);
      });
      break;
    case 'Delete':
      deleteZoneAssociation(properties, function(err, data) {
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
