/**
 * This script was developed by Guberni and is part of Tellki's Monitoring Solution
 *
 * May, 2015
 * 
 * Version 1.0
 * 
 * DESCRIPTION: Monitor Docker containers
 *
 * SYNTAX: node docker_monitor.js <METRIC_STATE> <AGGREGATE> <FILTER_CONTAINER_NAME> <FILTER_IMAGE_REPOSITORY_AND_TAG> <FILTER_COMMAND>
 * 
 * EXAMPLE: node docker_monitor.js "1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1" "0" "" "" ""
 *
 * README:
 *		<METRIC_STATE> is generated internally by Tellki and it's only used by Tellki default monitors: 1 - metric is on; 0 - metric is off
 *		<AGGREGATE> Aggregate all containers metrics
 *		<FILTER_CONTAINER_NAME> Filter containers by name
 *		<FILTER_IMAGE_REPOSITORY_AND_TAG> Filter containers by repository and tag
 *		<FILTER_COMMAND> Filter containers by command running
 */

var fs = require('fs');
var net = require('net');
var crypto = require('crypto');
 
/**
 * Metrics.
 */
var metrics = [];

metrics['RunningContainers']	= { id: '1574:Running Containers:4',		ratio: false, object : false, output : true, get : function(data, runningContainers) { return runningContainers; } };

metrics['ReceivedBytes']		= { id: '1575:Network Bytes In/Sec:4',		ratio: true, object : true, output : true, get : function(data) { return (data.network.rx_bytes / 1024 / 1024).toFixed(2); } };
metrics['ReceivedErrors']		= { id: '1576:Network Errors In/Sec:4',		ratio: true, object : true, output : true, get : function(data) { return data.network.rx_errors; } };
metrics['ReceivedDropped']		= { id: '1577:Network Drops In/Sec:4',		ratio: true, object : true, output : true, get : function(data) { return data.network.rx_dropped; } };
metrics['TransmittedBytes']		= { id: '1578:Network Bytes Out/Sec:4',		ratio: true, object : true, output : true, get : function(data) { return (data.network.tx_bytes / 1024 / 1024).toFixed(2); } };
metrics['TransmittedErrors']	= { id: '1579:Network Errors Out/Sec:4',	ratio: true, object : true, output : true, get : function(data) { return data.network.tx_errors; } };
metrics['TransmittedDropped']	= { id: '1580:Network Drops Out/Sec:4',		ratio: true, object : true, output : true, get : function(data) { return data.network.tx_dropped; } };

metrics['CPUTotalUsage']		= { id: '1581:% CPU Total:4',				ratio: true, object : true, output : true, get : function(data) { return data.cpu_stats.cpu_usage.total_usage; } };
metrics['CPUUsageKernel']		= { id: '1582:% CPU Kernel:4',				ratio: true, object : true, output : true, get : function(data) { return data.cpu_stats.cpu_usage.usage_in_kernelmode; } };
metrics['CPUUsageUser']			= { id: '1583:% CPU User:4',				ratio: true, object : true, output : true, get : function(data) { return data.cpu_stats.cpu_usage.usage_in_usermode; } };
metrics['CPUSystem']			= { id: '___:CPUSystem:4',					ratio: true, object : true, output : false, get : function(data) { return data.cpu_stats.system_cpu_usage; } };
metrics['CPUProc']				= { id: '___:CPUProc:4',					ratio: false, object : true, output : false, get : function(data) { return data.cpu_stats.cpu_usage.percpu_usage.length; } };

metrics['MemoryUsage']			= { id: '1584:Memory Usage:4',				ratio: false, object : true, output : true, get : function(data) { return (data.memory_stats.usage / 1024 / 1024).toFixed(2); } };
metrics['MemoryCache']			= { id: '1585:Memory Cache:4',				ratio: false, object : true, output : true, get : function(data) { return (data.memory_stats.stats.cache / 1024 / 1024).toFixed(2); } };
metrics['MemoryRss']			= { id: '1586:Memory RSS:4',				ratio: false, object : true, output : true, get : function(data) { return (data.memory_stats.stats.rss / 1024 / 1024).toFixed(2); } };

metrics['IORead']				= { id: '1587:IO Bytes Read/Sec:4',			ratio: true, object : true, output : true, get : function(data) { return (data.blkio_stats.io_service_bytes_recursive[0].value / 1024 / 1024).toFixed(2); } };
metrics['IOWrite']				= { id: '1588:IO Bytes Write/Sec:4',		ratio: true, object : true, output : true, get : function(data) { return (data.blkio_stats.io_service_bytes_recursive[1].value / 1024 / 1024).toFixed(2); } };
metrics['IOAsync']				= { id: '1589:IO Bytes Async/Sec:4',		ratio: true, object : true, output : true, get : function(data) { return (data.blkio_stats.io_service_bytes_recursive[3].value / 1024 / 1024).toFixed(2); } };
metrics['IOSync']				= { id: '1590:IO Bytes Sync/Sec:4',			ratio: true, object : true, output : true, get : function(data) { return (data.blkio_stats.io_service_bytes_recursive[2].value / 1024 / 1024).toFixed(2); } };

var tempDir = '/tmp';
var defaultSocker = '/var/run/docker.sock';
var request, client, containers, images, response = '', processed = 0, sleepTime = 1000;

/**
 * Entry point.
 */
(function() {
	try
	{
		monitorInput(process.argv);
	}
	catch (err)
	{
		if (err instanceof InvalidParametersNumberError)
		{
			console.log(err.message);
			process.exit(err.code);
		}
		else
		{
			console.log(err.message);
			process.exit(1);
		}
	}
}).call(this);

// ############################################################################
// PARSE INPUT

/**
 * Verify number of passed arguments into the script.
 */
function monitorInput(args)
{
	// Reset global vars.
	processed = 0;

	// Process.
	args = args.slice(2);
	if (args.length != 5)
		throw new InvalidParametersNumberError();
	
	monitorInputProcess(args);
}

/**
 * Process the passed arguments and send them to monitor execution.
 * Receive: arguments to be processed
 */
function monitorInputProcess(args)
{
	//<METRIC_STATE>
	var metricState = args[0].replace('\'', '');
	var tokens = metricState.split(',');
	var metricsExecution = new Array(17);
	for(var i in tokens)
		metricsExecution[i] = (tokens[i] === '1');
	
	//<AGGREGATE>
	var aggregate = args[1];
	
	//<FILTER_CONTAINER_NAME>
	var filterContainerName = args[2];
	
	//<FILTER_IMAGE_REPOSITORY_AND_TAG>
	var filterImageRepo = args[3];
	
	//<FILTER_COMMAND>
	var filterCommand = args[4];
	
	// Create request object to be executed.	
	request = new Object();
	request.metricsExecution = metricsExecution;
	request.aggregate = aggregate === '0' ? false : true;
	request.filterContainerName = filterContainerName.length === 0 ? [] : filterContainerName.split(';');
	request.filterImageRepo = filterImageRepo.length === 0 ? [] : filterImageRepo.split(';');
	request.filterCommand = filterCommand.length === 0 ? [] : filterCommand.split(';');
	
	// Call monitor.
	monitorDocker();
}

// ############################################################################
// GET METRICS

function monitorDocker() 
{
	client = new net.Socket();
	
	client.connect(defaultSocker, function() {
		// Start requests.
		getContainers(client);
	});
	
	client.on('error', function(e) {
		errorHandler(new APIAccessError());
	});
}

// ### Get containers.

function getContainers(client)
{
	// Get data.
	client.on('data', getContainersResponse);
	
	client.write('GET /containers/json?all=1&filters={%22status%22:[%22running%22]} HTTP/1.1\n\n');
}

function getContainersResponse(data)
{	
	readResponse(data, function(response) {

		// Parse containers.
		containers = parseHttpResponse(response);

		if (containers === null)
			errorHandler(new APIAccessError());
		
		// Next request.
		getImages(client);
	});
}

// ### Get images.

function getImages(client)
{
	// Remove old listner.
	client.removeListener('data', getContainersResponse);
	
	// Get data.
	client.on('data', getImagesResponse);
	
	client.write('GET /images/json?all=1 HTTP/1.1\n\n');
}

function getImagesResponse(data)
{
	readResponse(data, function(response) {
		
		// Parse images.
		images = parseHttpResponse(response);
		
		if (images === null)
			errorHandler(new APIAccessError());

		filterContainers();
	});
}

// ### Filter containers.

function filterContainers()
{
	// Join containers and image details.
	joinImages();

	// Filter containers.
	var filteredContainers = [];

	for (var i = 0; i < containers.length; i++)
	{
		var container = containers[i];
			
		if (match(container.Names, request.filterContainerName) &&
			match(container.UsedImage.RepoTags, request.filterImageRepo) &&
			match([ container.Command ], request.filterCommand))
		{
			filteredContainers.push(container)
		}
	}
	
	containers = filteredContainers;
	
	if (containers.length === 0)
	{
		console.log(metrics['RunningContainers'].id + '|0||');
		
		client.destroy();
	}
	else
	{
		for (var i = 0; i < containers.length; i++)
		{
			var container = containers[i];
			
			getMetrics(container);
		}
	}
		
	client.destroy();
}

function getMetrics(container)
{
	var client = new net.Socket();
	
	client.connect(defaultSocker, function() {
		
		// Start requests.
		client.write('GET /containers/' + container.Id + '/stats HTTP/1.1\n\n');
	});
	
	// Get data.
	client.on('data', function(data) {
		
		data = parseHttpResponse(data);

		if (data !== null)
		{
			container.Metrics = {};
			
			for (var m in metrics)
			{
				var metric = metrics[m];
				
				if (metric.get !== undefined)
				{
					// Get metric value.
					
					try
					{
						container.Metrics[m] = metric.get(data, containers.length);
					}
					catch (e)
					{
						// Ignore.
					}
				}
			}
		}
				
		client.destroy();
		processed++;
		
		if (processed == containers.length)
			processMetrics();
	});
	
	client.on('error', function(e) {
		errorHandler(new APIAccessError());
	});
}

function processMetrics()
{
	var jsonString = '[';				
	var dateTime = new Date().toISOString();
	
	for (var c = 0; c < containers.length; c++)
	{		
		var container = containers[c];
		
		var j = 0;
		for (var key in metrics)
		{			
			if (!metrics.hasOwnProperty(key))
				continue;
			
			if (request.metricsExecution[j])
			{
				var metric = metrics[key];
				var val = container.Metrics[key];
				
				if (metrics[key].object)
				{
					jsonString += '{';
					jsonString += '"variableName":"'	+ key					+ '",';
					jsonString += '"metricUUID":"'		+ metric.id				+ '",';
					jsonString += '"timestamp":"'		+ dateTime				+ '",';
					jsonString += '"value":"'			+ val					+ '",';
					jsonString += '"output":"'			+ metric.output			+ '",';
					jsonString += '"object":"'			+ container.Names[0].replace(/\//g, '')	+ '"';
					jsonString += '},';
				}
				else
				{
					jsonString += '{';
					jsonString += '"variableName":"'	+ key					+ '",';
					jsonString += '"metricUUID":"'		+ metric.id				+ '",';
					jsonString += '"timestamp":"'		+ dateTime				+ '",';
					jsonString += '"value":"'			+ val					+ '",';
					jsonString += '"output":"'			+ metric.output			+ '"';
					jsonString += '},';
				}
			}

			if (metrics[key].output)
			{
				j++;
			}
		}
	}
	
	if(jsonString.length > 1)
		jsonString = jsonString.slice(0, jsonString.length - 1);
			
	jsonString += ']';
		
	processDeltas(jsonString);
}

function match(matchValues, matchList)
{
	if (matchList.length === 0)
		return true;
	
	for (var i = 0; i < matchList.length; i++)
	{
		var match = matchList[i];
		
		for (var j = 0; j < matchValues.length; j++)
		{
			var matchValue = matchValues[j];
						
			if (matchValue.trim().toLowerCase().indexOf(match.trim().toLowerCase()) !== -1)
			{
				return true;
			}
		}
	}
	
	return false;
}

function joinImages()
{
	for (var i = 0; i < containers.length; i++)
	{
		var container = containers[i];
		var found = false;
		
		for (var j = 0; j < images.length; j++)
		{
			var image = images[j];
			
			for (var k = 0; k < image.RepoTags.length; k++)
			{
				var repoTag = image.RepoTags[k];
				
				if (container.Image === repoTag)
				{
					container.UsedImage = image;
					found = true;
					break;
				}
			}
			
			if (found)
				continue;
		}
	}
}

// ### Read and parse HTTP responses.

function readResponse(data, callback)
{
	data = data.toString().trim();
	var process = false;
	response += data;

	if (data.indexOf('Transfer-Encoding: chunked') >= 0 || data.indexOf('HTTP/1.1') === -1)
	{
		if (response[response.length - 2] === '\n' && response[response.length - 1] === '0')
			process = true;
	}
	else
	{
		process = true;
	}
	
	if (process)
	{
		callback(response);
		response = '';
	}
}

function parseHttpResponse(data)
{	
	var lines = data.toString().split('\r\n');
	var cleanData = '';
	var addToCleanData = false;
	
	for(var i = 0; i < lines.length; i++)
	{
		var line = lines[i].trim();
		
		if (addToCleanData)
		{
			if (!line.match(/^[0-9a-f]+$/))
				cleanData += line;
		}
		else
		{
			if (line.indexOf('HTTP/1.1') === 0 && !parseHttpResponseCode(line))
				return null;
			
			if (line === '')
				addToCleanData = true;
		}
	}

	return JSON.parse(cleanData);
}

function parseHttpResponseCode(line)
{
	if (line.indexOf('200') !== -1)
		return true; // Valid response.
	
	return false;
}

// ############################################################################
// OUTPUT METRICS

function removeDuplicates(metrics)
{
	var newMetrics = [];
	var lookup = {};
	
	for (var i = 0; i < metrics.length; i++)
	{
		var metric = metrics[i];
		var key = '' + metric.variableName + metric.object;
		
		if (lookup[key] === undefined)
		{
			newMetrics.push(metric);
			lookup[key] = {};
		}
	}
	
	return newMetrics;
}

/*
* Process performance results
* Receive: 
* - request object containing configuration
* - retrived results
*/
function processDeltas(results)
{
	var file = getFile();
	var toOutput = [];
	
	if (file)
	{		
		var previousData = JSON.parse(file);
		var newData = JSON.parse(results);
		
		newData = removeDuplicates(newData);
		
		for (var i = 0; i < newData.length; i++)
		{
			var endMetric = newData[i];
			var initMetric = null;
			
			for (var j = 0; j < previousData.length; j++)
			{
				if(previousData[j].metricUUID === newData[i].metricUUID
					&& previousData[j].object === newData[i].object)
				{
					initMetric = previousData[j];
					break;
				}
			}

			if (initMetric != null)
			{
				var deltaValue = getDelta(initMetric, endMetric, previousData, newData);

				var rateMetric = new Object();
				rateMetric.id = endMetric.metricUUID;
				rateMetric.timestamp = endMetric.timestamp;
				rateMetric.value = deltaValue;
				rateMetric.output = endMetric.output;
				if (endMetric.object !== undefined)
					rateMetric.object = endMetric.object;

				toOutput.push(rateMetric);
			}
			else
			{	
				var rateMetric = new Object();
				rateMetric.id = endMetric.metricUUID;
				rateMetric.timestamp = endMetric.timestamp;
				rateMetric.value = 0;
				rateMetric.output = endMetric.output;
				if (endMetric.object !== undefined)
					rateMetric.object = endMetric.object;
				
				toOutput.push(rateMetric);
			}
		}
		
		setFile(results);
		
		for (var m = 0; m < toOutput.length; m++)
		{
			for (var z = 0; z < newData.length; z++)
			{				
				var systemMetric = metrics[newData[z].variableName];
								
				if (systemMetric.ratio === false
					&& newData[z].metricUUID === toOutput[m].id
					&& newData[z].object === toOutput[m].object)
				{					
					toOutput[m].value = newData[z].value;
					break;
				}
			}
		}
		
		output(toOutput);
	}
	else
	{
		setFile(results);

		// Execute again.
		setTimeout(function() {
			monitorInput(process.argv);
		}, sleepTime);
	}
}

/**
 * Calculate ratio metric's value
 * Receive: 
 * - previous value
 * - current value
 * - 
 */
function getDelta(initMetric, endMetric, initMetrics, endMetrics)
{
	var deltaValue = 0;

	var decimalPlaces = 2;

	var date = new Date().toISOString();
	
	if (parseFloat(endMetric.value) < parseFloat(initMetric.value))
	{	
		deltaValue = parseFloat(endMetric.value).toFixed(decimalPlaces);
	}
	else
	{	
		var elapsedTime = (new Date(endMetric.timestamp).getTime() - new Date(initMetric.timestamp).getTime()) / 1000;	
		deltaValue = ((parseFloat(endMetric.value) - parseFloat(initMetric.value))/elapsedTime).toFixed(decimalPlaces);
	}
	
	if (initMetric.variableName === 'CPUTotalUsage' || initMetric.variableName === 'CPUUsageUser' || initMetric.variableName === 'CPUUsageKernel')
	{
		var value1 = initMetric.value;
		var value2 = endMetric.value;
		
		var system1 = getMetricByName('CPUSystem', initMetrics);
		var system2 = getMetricByName('CPUSystem', endMetrics);
		
		var proc2 = getMetricByName('CPUProc', endMetrics);

		if (system1 !== null && system2 != null && proc2 != null)
		{
			system1 = system1.value;
			system2 = system2.value;
			
			var v1 = value2 - value1;
			var v2 = system2 - system1;
			
			if (v1 > 0 && v2 > 0)
				return ((v1) / (v2) * proc2.value * 100).toFixed(2) + '';

			return '0';
		}
	}
	
	return deltaValue + '';
}

function getMetricByName(name, metrics)
{
	for (var i = 0; i < metrics.length; i++)
	{
		if (metrics[i].variableName === name)
			return metrics[i];
	}
	
	return null;
}

/**
 * Send metrics to console
 * Receive: metrics list to output
 */
function output(toOutput)
{
	if (request.aggregate)
	{
		var toShow = {};
		
		for (var i = 0; i < toOutput.length; i++)
		{
			var metric = toOutput[i];
			
			if (metric.value != '' && !isNaN(metric.value) && metric.output === 'true')
			{
				if (toShow[metric.id] === undefined)
				{
					toShow[metric.id] = {
						id : metric.id,
						value : parseFloat(metric.value),
					};
				}
				else
				{
					toShow[metric.id].value += parseFloat(metric.value);
				}
			}
		}
		
		for (var key in toShow)
		{
			var v = toShow[key].value;
			var out = '';
			
			out += toShow[key].id;
			out += '|';
			out += isInt(v) ? v : v.toFixed(2);
			out += '||';
			
			console.log(out);
		}
	}
	else
	{
		for (var i = 0; i < toOutput.length; i++)
		{
			if (toOutput[i].value != '' && !isNaN(toOutput[i].value) && toOutput[i].output === 'true')
			{
				var v = parseFloat(toOutput[i].value);
				var out = '';
				
				out += toOutput[i].id;
				out += '|';
				out += isInt(v) ? v : v.toFixed(2);
				out += '|';
				if (toOutput[i].object !== undefined)
					out += toOutput[i].object;
				out += '|';
				
				console.log(out);
			}
		}
	}
}

function isInt(n)
{
   return n % 1 === 0;
}

/*
* Get last results if any saved
* Receive: 
* - haproxy csv url path
*/
function getFile()
{
	var id = {
	  'k1' : request.aggregate,
	  'k2' : request.filterContainerName,
	  'k3' : request.filterImageRepo,
	  'k4' : request.filterCommand
	};
	var dirPath =  __dirname +  tempDir + '/';
	var filePath = dirPath + '.docker_'+ encodeURIComponent(crypto.createHash('md5').update(JSON.stringify(id)).digest('hex')) +'.dat';

	try
	{
		fs.readdirSync(dirPath);
		
		var file = fs.readFileSync(filePath, 'utf8');
		
		if (file.toString('utf8').trim())
		{
			return file.toString('utf8').trim();
		}
		else
		{
			return null;
		}
	}
	catch(e)
	{
		return null;
	}
}

/*
* Save current metrics values to be used to calculate ratios on next runs
* Receive: 
* - haproxy csv url path
* - retrieved result
*/
function setFile(json)
{
	var id = {
	  'k1' : request.aggregate,
	  'k2' : request.filterContainerName,
	  'k3' : request.filterImageRepo,
	  'k4' : request.filterCommand
	};
	var dirPath =  __dirname +  tempDir + '/';
	var filePath = dirPath + '.docker_'+ encodeURIComponent(crypto.createHash('md5').update(JSON.stringify(id)).digest('hex')) +'.dat';
		
	if (!fs.existsSync(dirPath)) 
	{
		try
		{
			fs.mkdirSync( __dirname+tempDir);
		}
		catch(e)
		{
			var ex = new CreateTmpDirError(e.message);
			ex.message = e.message;
			errorHandler(ex);
		}
	}

	try
	{
		fs.writeFileSync(filePath, json);
	}
	catch(err)
	{
		var ex = new WriteOnTmpFileError(e.message);
		ex.message = err.message;
		errorHandler(ex);
	}
}

// ############################################################################
// ERROR HANDLER

/**
 * Used to handle errors of async functions
 * Receive: Error/Exception
 */
function errorHandler(err)
{
	if(err instanceof APIAccessError)
	{
		console.log(err.message);
		process.exit(err.code);
	}
	else if(err instanceof MetricNotFoundError)
	{
		console.log(err.message);
		process.exit(err.code);
	}
	else if(err instanceof CreateTmpDirError)
	{
		console.log(err.message);
		process.exit(err.code);
	}
	else if(err instanceof WriteOnTmpFileError)
	{
		console.log(err.message);
		process.exit(err.code);
	}
	else
	{
		console.log(err.message);
		process.exit(1);
	}
}

// ############################################################################
// EXCEPTIONS

/**
 * Exceptions used in this script.
 */
function InvalidParametersNumberError() {
    this.name = 'InvalidParametersNumberError';
    this.message = 'Wrong number of parameters.';
	this.code = 3;
}
InvalidParametersNumberError.prototype = Object.create(Error.prototype);
InvalidParametersNumberError.prototype.constructor = InvalidParametersNumberError;

function APIAccessError() {
    this.name = 'APIAccessError';
    this.message = 'Can\'t access Docker API';
	this.code = 30;
}
APIAccessError.prototype = Object.create(Error.prototype);
APIAccessError.prototype.constructor = APIAccessError;

function MetricNotFoundError() {
    this.name = 'MetricNotFoundError';
    this.message = '';
	this.code = 8;
}
MetricNotFoundError.prototype = Object.create(Error.prototype);
MetricNotFoundError.prototype.constructor = MetricNotFoundError;

function CreateTmpDirError()
{
	this.name = 'CreateTmpDirError';
    this.message = '';
	this.code = 21;
}
CreateTmpDirError.prototype = Object.create(Error.prototype);
CreateTmpDirError.prototype.constructor = CreateTmpDirError;


function WriteOnTmpFileError()
{
	this.name = 'WriteOnTmpFileError';
    this.message = '';
	this.code = 22;
}
WriteOnTmpFileError.prototype = Object.create(Error.prototype);
WriteOnTmpFileError.prototype.constructor = WriteOnTmpFileError;
