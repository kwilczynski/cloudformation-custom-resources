'use strict';

function getElastiCacheClusterByName(properties, callback) {
  if (typeof properties.CacheClusterId === 'undefined') {
    return callback(new Error('The CacheClusterId property was not specified.'));
  }

  let aws = require('aws-sdk');
  let elasticache = new aws.ElastiCache();

  let params = {
    CacheClusterId: properties.CacheClusterId,
    ShowCacheNodeInfo: false
  };

  console.log('getElastiCacheClusterByName', properties, params);

  elasticache.describeCacheClusters(params, function(err, data) {
    console.log('describeCacheClusters', err, data);

    if (err) {
      return callback(err);
    }

    let matching =
      data.CacheClusters.filter(function(cluster) {
        return cluster.CacheClusterId === properties.CacheClusterId;
      });

    console.log('describeCacheClusters', matching);

    if (matching.length === 0) {
      return callback(new Error('Matching ElastiCache clusters could not be found.'));
    }

    if (matching.length > 1) {
      return callback(new Error('More than one matching ElastiCache cluster was found.'));
    }

    let cluster = matching[0];

    let statuses = [
      'available',
      'creating',
      'modifying'
    ];

    if (statuses.indexOf(cluster.CacheClusterStatus) === -1) {
      return callback(new Error('Matching ElastiCache cluster is not available.'));
    }

    let cacheSecurityGroups = [];
    cluster.CacheSecurityGroups.forEach(function(sg) {
      if (sg.Status === 'active') {
        securityGroups.push(sg.CacheSecurityGroupName);
      }
    });

    let securityGroups = [];
    cluster.SecurityGroups.forEach(function(sg) {
      if (sg.Status === 'active') {
        securityGroups.push(sg.SecurityGroupId);
      }
    });

    let configurationEndpoint = '' +
      cluster.ConfigurationEndpoint.Address + ':' +
      cluster.ConfigurationEndpoint.Port;

    return callback(null, {
      CacheClusterId: cluster.CacheClusterId,
      ConfigurationEndpoint: configurationEndpoint,
      CacheNodeType: cluster.CacheNodeType,
      Engine: cluster.Engine,
      EngineVersion: cluster.EngineVersion,
      CacheSecurityGroups: cacheSecurityGroups,
      CacheSubnetGroupName: cluster.CacheSubnetGroupName,
      SecurityGroups: securityGroups
    });
  });
}

getElastiCacheClusterByName.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, context, 'SUCCESS');
  }

  getElastiCacheClusterByName(event.ResourceProperties, function(err, data) {
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
    PhysicalResourceId: 'getElastiCacheClusterByName-' + event.ResourceProperties.CacheClusterId,
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

module.exports = getElastiCacheClusterByName;

if (require.main === module) {
  let fs = require('fs');

  console.log('getElastiCacheClusterByName called directly.');

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
    getElastiCacheClusterByName(properties, function(err, data) {
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
