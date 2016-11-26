'use strict';

function getAmazonMachineImage(properties, callback) {
  let name = null;
  if (typeof properties.Name !== 'undefined') {
    if (!properties.Name || !properties.Name.trim()) {
      return callback(new Error('The Name property cannot be empty.'));
    }
    name = properties.Name;
  }

  let regex = null;
  if (typeof properties.Regex !== 'undefined') {
    try {
      regex = new RegExp(properties.Regex);
    } catch(e) {
      return callback(new Error('The Regex property contains an invalid regular expression: ' + e));
    }
  }

  let owners = ['self'];
  if (typeof properties.Owners !== 'undefined') {
    if (!Array.isArray(properties.Owners)) {
      return callback(new Error('The Owners property must be an array.'));
    }
    owners = properties.Owners;
  }

  let executableUsers = ['all'];
  if (typeof properties.ExecutableUsers !== 'undefined') {
    if (!Array.isArray(properties.ExecutableUsers)) {
      return callback(new Error('The ExecutableUsers property must be an array.'));
    }
    executableUsers = properties.ExecutableUsers;
  }

  let filters = [{
    Name: 'state',
    Values: ['available']
  }];

  if (!name && !regex) {
    return callback(new Error('Either Name or Regex property has to be set.'));
  }

  if (name) {
    filters.push({
      Name: 'name',
      Values: [properties.Name]
    });
  }

  if (typeof properties.Filters !== 'undefined') {
    if (!Array.isArray(properties.Filters)) {
      return callback(new Error('The Filters property must be an array.'));
    }
    properties.Filters.forEach(function(object) {
      if (object.constructor != Object) {
        return callback(new Error('The Filters property must include a key-value pairs only.'));
      }
      filters.push(object);
    });
  }

  let latest = false;
  if (typeof properties.Latest !== 'undefined') {
    if (typeof toBoolean(properties.Latest) !== 'boolean') {
      return callback(new Error('The Latest property must be a boolean type.'));
    }
    latest = toBoolean(properties.Latest);
  }

  let aws = require('aws-sdk');
  let ec2 = new aws.EC2();

  let params = {
    Owners: owners,
    ExecutableUsers: executableUsers,
    Filters: filters
  };

  console.log('getAmazonMachineImage', properties, params);

  ec2.describeImages(params, function(err, data) {
    console.log('describeImages', err, data);

    if (err) {
      return callback(err);
    }

    let images = [];

    if (regex) {
      data.Images.forEach(function(image) {
        if ((typeof image.Name === 'undefined') || image.Name.length === 0) {
          console.log('Unable to find image name to match against for image ID "'
              + image.ImageId + '" owned by "' + image.OwnerId + '", nothing to do.');
          return;
        }
        if (regex.test(image.Name)) {
          images.push(image);
        }
      });
    } else {
      images = data.Images;
    }

    if (images.length < 1) {
      return callback(new Error('No images could be found.'));
    }

    let image = null;

    if (images.length > 1) {
      console.log('More than one image found, and the Latest property is set to ' + latest);
      if (latest) {
        images.sort(function(a, b) {
            a = new Date(a.CreationDate);
            b = new Date(b.CreationDate);
            return a > b ? -1 : a < b ? 1 : 0;
        });
        image = images[0];
      } else {
        return callback(new Error('More than one image was found.'));
      }
    } else {
      image = images[0];
    }

    delete image.Name;
    delete image.Description;
    delete image.State;
    delete image.StateReason;
    delete image.BlockDeviceMappings;
    delete image.ImageLocation;
    delete image.CreationDate;
    delete image.ProductCodes;
    delete image.Tags;

    console.log('describeImages', image);

    return callback(null, image);
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

getAmazonMachineImage.handler = function(event, context) {
  console.log(JSON.stringify(event, null, 2));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, context, 'SUCCESS');
  }

  getAmazonMachineImage(event.ResourceProperties, function(err, data) {
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
    PhysicalResourceId: 'getAmazonMachineImage-' + event.ResourceProperties.Name,
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

module.exports = getAmazonMachineImage;

if (require.main === module) {
  let fs = require('fs');

  console.log('getAmazonMachineImage called directly.');

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
    getAmazonMachineImage(properties, function(err, data) {
      console.log('Result: ', err, data);
    });
  } else {
    console.log('Unknown event RequestType: ' + properties.RequestType);
    process.exit(1);
  }
}

function usageExit() {
  let path = require('path');
  console.error('Usage: ' + path.basename(process.argv[1]) + ' JSON file.');
  process.exit(1);
}
