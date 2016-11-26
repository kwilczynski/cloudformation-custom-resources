'use strict';

function getStackOutputs(properties, callback) {
  if (typeof properties.StackName === 'undefined') {
    return callback(new Error('The StackName property was not specified.'));
  }

  let filter = [];
  if (typeof properties.Filter !== 'undefined') {
    if (!Array.isArray(properties.Filter)) {
      return callback(new Error('The Filter property must be an array.'));
    }
    filter = properties.Filter;
  }

  let aws = require('aws-sdk');
  let cloudformation = new aws.CloudFormation();

  let params = {
    StackName: properties.StackName
  };

  console.log('getStackOutputs', properties, params);

  cloudformation.describeStacks(params, function(err, data) {
    console.log('describeStacks', err, data);

    if (err) {
      return callback(err);
    }

    let stack = data.Stacks[0];

    let statuses = [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE',
      'UPDATE_ROLLBACK_COMPLETE'
    ];

    if (statuses.indexOf(stack.StackStatus) === -1) {
      return callback(new Error('Unable to get outputs for a stack "'
        + properties.StackName + '" in state "' + stack.StackStatus
        + '", aborting.'));
    }

    if (filter.length === 0) {
      console.log('No output filter was specified, will return all outputs.');
    }

    let outputs = {};
    stack.Outputs.forEach(function(output) {
      if (filter.length > 0) {
        if (filter.indexOf(output.OutputKey) > -1) {
          outputs[output.OutputKey] = output.OutputValue;
        }
      } else {
        outputs[output.OutputKey] = output.OutputValue;
      }
    });

    if (Object.keys(outputs).length === 0) {
      if (filter.length > 0) {
        return callback(new Error('No matching outputs were found.'));
      }
      return callback(new Error('Stack has no outputs.'));
    }

    return callback(null, outputs);
  });
}

getStackOutputs.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, context, 'SUCCESS');
  }

  getStackOutputs(event.ResourceProperties, function(err, data) {
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
    PhysicalResourceId: 'getStackOutputs-' + event.ResourceProperties.StackName,
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

module.exports = getStackOutputs;

if (require.main === module) {
  let fs = require('fs');

  console.log('getStackOutputs called directly.');

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
    getStackOutputs(properties, function(err, data) {
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
