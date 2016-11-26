'use strict';

function getVpcByName(properties, callback) {
  if (typeof properties.VpcName === 'undefined') {
    return callback(new Error('The VpcName property was not specified.'));
  }

  let onlyDefaultSubnets = false;
  if (typeof properties.OnlyDefaultSubnets !== 'undefined') {
    if (typeof toBoolean(properties.OnlyDefaultSubnets) !== 'boolean') {
      return callback(new Error('The OnlyDefaultSubnets property must be a boolean type.'));
    }
    onlyDefaultSubnets = toBoolean(properties.OnlyDefaultSubnets);
  }

  let onlyPublicSubnets = false;
  if (typeof properties.OnlyPublicSubnets !== 'undefined') {
    if (typeof toBoolean(properties.OnlyPublicSubnets) !== 'boolean') {
      return callback(new Error('The OnlyPublicSubnets property must be a boolean type.'));
    }
    onlyPublicSubnets = toBoolean(properties.OnlyPublicSubnets);
  }

  let onlyPrivateSubnets = false;
  if (typeof properties.OnlyPrivateSubnets !== 'undefined') {
    if (typeof toBoolean(properties.OnlyPrivateSubnets) !== 'boolean') {
      return callback(new Error('The OnlyPrivateSubnets property must be a boolean type.'));
    }
    onlyPrivateSubnets = toBoolean(properties.OnlyPrivateSubnets);
  }

  let aws = require('aws-sdk');
  let ec2 = new aws.EC2();

  let filters = [{
    Name: 'state',
    Values: ['available']
  }];

  let params = {
    Filters: filters
  };

  console.log('getVpcByName', properties, params);

  ec2.describeVpcs(params, function(err, data) {
    console.log('describeVpcs', err, data);

    if (err) {
      return callback(err);
    }

    let matching =
      data.Vpcs.filter(function(vpc) {
        if (properties.VpcName === 'default') {
          return vpc.IsDefault;
        } else {
          let matchingTags =
            vpc.Tags.filter(function(tag) {
              return tag.Key === 'Name' && tag.Value === properties.VpcName;
            });
          return matchingTags.length > 0;
        }
      });

    console.log('describeVpcs', matching);

    if (matching.length === 0) {
      return callback(new Error('Matching VPC could not be found.'));
    }

    if (matching.length > 1) {
      return callback(new Error('More than one matching VPC was found.'));
    }

    let match = matching[0];

    delete match.Tags;
    delete match.State;
    delete match.InstanceTenancy;
    delete match.IsDefault;

    filters.push({
      Name: 'vpc-id',
      Values: [match.VpcId]
    });

    if (onlyDefaultSubnets) {
      filters.push({
        Name: 'default-for-az',
        Values: ['true']
      });
    }

    if (onlyPublicSubnets) {
      filters.push({
        Name: 'tag:Type',
        Values: ['Public']
      });
    }

    if (onlyPrivateSubnets) {
      filters.push({
        Name: 'tag:Type',
        Values: ['Private']
      });
    }

    let params = {
      Filters: filters
    };

    ec2.describeSubnets(params, function(err, data) {
      console.log('describeSubnets', params, data);

      let subnetIds = [];
      let cidrBlocks = [];

      data.Subnets.forEach(function(subnet, i) {
        subnetIds.push(subnet.SubnetId);
        cidrBlocks.push(subnet.CidrBlock);
      });

      match.Subnets = subnetIds;
      match.SubnetIds = subnetIds.join(',');
      match.CidrBlocks = cidrBlocks;

      return callback(null, match);
    });
  });
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

getVpcByName.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, context, 'SUCCESS');
  }

  getVpcByName(event.ResourceProperties, function(err, data) {
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
    PhysicalResourceId: 'getVpcByName-' + event.ResourceProperties.VpcName,
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

module.exports = getVpcByName;

if (require.main === module) {
  let fs = require('fs');

  console.log('getVpcByName called directly.');

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
    getVpcByName(properties, function(err, data) {
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
