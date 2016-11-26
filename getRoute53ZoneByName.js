'use strict';

function getRoute53ZoneByName(properties, callback) {
  if (typeof properties.DomainName === 'undefined') {
    return callback(new Error('The DomainName property was not specified.'));
  }

  let domainName = normalizeZoneName(properties.DomainName);

  let vpcId = null;
  if (typeof properties.VpcId !== 'undefined') {
    vpcId = properties.VpcId;
  }

  let comment = null;
  if (typeof properties.Comment !== 'undefined') {
    comment = properties.Comment;
  }

  let tags = [];
  if (typeof properties.Tags !== 'undefined') {
    if (!Array.isArray(properties.Tags)) {
      return callback(new Error('The Tags property must be an array.'));
    }
    properties.Tags.forEach(function(object) {
      if (object.constructor != Object) {
        return callback(new Error('The Tags property must include a key-value pairs only.'));
      }
      tags.push(object);
    });
  }

  let privateZone = null;
  if (typeof properties.PrivateZone !== 'undefined') {
    if (typeof toBoolean(properties.PrivateZone) !== 'boolean') {
      return callback(new Error('The PrivateZone property must be a boolean type.'));
    }
    privateZone = toBoolean(properties.PrivateZone);
  }

  let aws = require('aws-sdk');
  let route53 = new aws.Route53();

  console.log('getRoute53ZoneByName', properties);

  route53.listHostedZones().promise()
    .then(function(data) {
      console.log('listHostedZones', data);

      if (vpcId) {
        return Promise.all(data.HostedZones.map(function(zone) {
          let params = {
            Id: zone.Id
          };
          console.log('getHostedZone', params);
          return route53.getHostedZone(params).promise();
        }));
      }

      return data;
    })
    .then(function(data) {
      if (vpcId) {
        let zones = [];

        data.forEach(function(zone) {
          zone.HostedZone.VPCs = zone.VPCs;
          zones.push(zone.HostedZone);
        });

        return zones;
      }

      return data.HostedZones;
    })
    .then(function(data) {
      if (tags.length) {
        return Promise.all(data.map(function(zone) {
          let params = {
            ResourceId: zone.Id,
            ResourceType: 'hostedzone'
          };

          console.log('listTagsForResource', params);
          return route53.listTagsForResource(params).promise();
        }))
        .then(function(tags) {
          data.forEach(function(zone) {
            tags.forEach(function(tag) {
              let resource = tag.ResourceTagSet;
              if (resource.ResourceId == normalizeZoneIdentifier(zone.Id)) {
                zone.Tags = resource.Tags;
              }
            });
          });

          return data;
        })
        .catch(function(err) {
          throw err;
        });
      }

      return data;
    })
    .then(function(data) {
      console.log('getHostedZone', data);

      let matching = {};

      data.forEach(function(zone) {
        let checkPrivateZone = privateZone !== null;

        let hasName = normalizeZoneName(zone.Name) === domainName;
        let hasPrivateZone = zone.Config.PrivateZone === privateZone;
        let hasComment = zone.Config.Comment === comment;
        let hasTags = false;
        let hasVpc = false;

        if (tags.length) {
          hasTags = compareObjects(tags, zone.Tags);
        }

        if (vpcId) {
          zone.VPCs.forEach(function(vpc) {
            if (vpc.VPCId === vpcId) {
              hasVpc = true;
              return;
            }
          });
        }

        let score = 0;

        if (hasName) {
          score += 1;

          score += hasComment ? 1 : 0;
          score += hasTags    ? 1 : 0;
          score += hasVpc     ? 1 : 0;

          score += (checkPrivateZone && hasPrivateZone) ? 1 : 0;
        }

        console.log('Hosted Zone "' + normalizeZoneIdentifier(zone.Id) + '" ('
          + normalizeZoneName(zone.Name) + ') has scored "' + score + '".');

        if (score) {
          (matching[score] = (matching[score] || [])).push(zone);
        }
      });

      return matching[Math.max.apply(null, Object.keys(matching))] || [];
    })
    .then(function(matching) {
      console.log('listHostedZones', matching);

      if (matching.length === 0) {
        throw new Error('Matching Hosted Zone could not be found.');
      }

      if (matching.length > 1) {
        throw new Error('More than one matching Hosted Zone was found.');
      }

      let match = matching[0];

      return callback(null, {
        Id: normalizeZoneIdentifier(match.Id),
        Name: normalizeZoneName(match.Name)
      });
    })
    .catch(function(err) {
      return callback(err);
    });
}

function normalizeZoneIdentifier(name) {
  return name.split('/')[2];
}

function normalizeZoneName(name) {
  if (name.substr(-1) === '.') {
    name = name.substring(0, name.length - 1);
  }
  return name;
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

function compareObjects(x, y) {
  return ((x && y) && (typeof x === 'object' && typeof y === 'object')) ?
    (Object.keys(x).length === Object.keys(y).length) &&
      Object.keys(x).every(function(key) {
        return compareObjects(x[key], y[key]);
      }, true) : (x === y);
}

getRoute53ZoneByName.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  if (event.RequestType == 'Delete') {
    return sendResponse(event, context, 'SUCCESS');
  }

  getRoute53ZoneByName(event.ResourceProperties, function(err, data) {
    let status = err ? 'FAILED' : 'SUCCESS';
    return sendResponse(event, context, status, data, err);
  });
};

module.exports = getRoute53ZoneByName;

function sendResponse(event, context, status, data, err) {
  let reason = err ? err + '; ' : '';

  let responseBody = {
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: 'getRoute53ZoneByName-' + event.ResourceProperties.DomainName,
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

  console.log('getRoute53ZoneByName called directly.');

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

  if (properties.RequestType === 'Create') {
    getRoute53ZoneByName(properties, function(err, data) {
      console.log('Result: ', err, data);
    });
  } else {
    console.log('Unknown event RequestType: ' + properties.RequestType);
    process.exit(1);
  }
}

function usageExit() {
  let path = require('path');
  console.log('Usage: ' + path.basename(process.argv[1]) + ' JSON file.');
  process.exit(1);
}
