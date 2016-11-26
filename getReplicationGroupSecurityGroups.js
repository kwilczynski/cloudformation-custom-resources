'use strict';

function getReplicationGroupSecurityGroups(properties, callback) {
  if (typeof properties.Description === 'undefined') {
    return callback(new Error('The Description property was not specified.'));
  }

  let aws = require('aws-sdk');
  let elasticache = new aws.ElastiCache();

  let statuses = [
    'available',
    'creating',
    'modifying'
  ];

  console.log('getReplicationGroupSecurityGroups', properties);

  elasticache.describeReplicationGroups().promise()
    .then(function(data) {
      console.log('describeReplicationGroups', data);

      let matching =
        data.ReplicationGroups.filter(function(rg) {
          return rg.Description === properties.Description;
        });

      console.log('describeReplicationGroups', matching);

      if (matching.length === 0) {
        throw new Error('Matching Replication Group could not be found.');
      }

      if (matching.length > 1) {
        throw new Error('More than one matching Replication Group was found.');
      }

      return matching;
    })
    .then(function(matching) {
      let rg = matching[0];
      if (statuses.indexOf(rg.Status) === -1) {
        throw new Error('Matching Replication Group is not available.');
      }

      let clusters = rg.MemberClusters;
      if (clusters.length === 0) {
        throw new Error('No Replication Group member clusters could not be found.');
      }

      return Promise.all(clusters.map(function(name) {
        let params = {
          CacheClusterId: name,
          ShowCacheNodeInfo: true
        };
        console.log('describeCacheClusters', params);
        return elasticache.describeCacheClusters(params).promise();
      }));
    })
    .then(function(data) {
      console.log('describeCacheClusters', data);

      let securityGroups = [];
      data.forEach(function(data) {
        let cluster = data.CacheClusters[0];

        if (statuses.indexOf(cluster.CacheClusterStatus) === -1) {
          throw new Error('Underlying Cache Cluster is not available.');
        }

        cluster.SecurityGroups.forEach(function(sg) {
          if (sg.Status === 'active') {
            securityGroups.push(sg.SecurityGroupId);
          }
        });
      });

      securityGroups = Array.from(new Set(securityGroups));

      return callback(null, {
        SecurityGroups: securityGroups,
        SecurityGroupsIds: securityGroups.join(',')
      });
    })
    .catch(function(err) {
      return callback(err);
    });
}

getReplicationGroupSecurityGroups.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, context, 'SUCCESS');
  }

  getReplicationGroupSecurityGroups(event.ResourceProperties, function(err, data) {
    let status = err ? 'FAILED' : 'SUCCESS';
    return sendResponse(event, context, status, data, err);
  });
};

function sendResponse(event, context, status, data, err) {
  let reason = err ? err + '; ' : '';

  let responseBody = {
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    PhysicalResourceId: 'getReplicationGroupSecurityGroups-' + event.ResourceProperties.Description,
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

module.exports = getReplicationGroupSecurityGroups;

if (require.main === module) {
  let fs = require('fs');

  console.log('getReplicationGroupSecurityGroups called directly.');

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
    getReplicationGroupSecurityGroups(properties, function(err, data) {
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
