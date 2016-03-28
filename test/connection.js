"use strict";

const sinon = require("sinon");
const stream = require("stream");
const EventEmitter = require("events");

describe("Connection", function() {
	let fakes, Connection;

	beforeEach(() => {
		fakes = {
			config: sinon.stub(),
			EndpointManager: sinon.stub(),
			endpointManager: new EventEmitter(),
		}

		fakes.EndpointManager.returns(fakes.endpointManager);

		Connection = require("../lib/connection")(fakes)
	})

	describe("constructor", function () {

		context("called without `new`", () => {
			it("returns a new instance", () => {
				expect(Connection()).to.be.an.instanceof(Connection);
			});
		});

		it("prepares the configuration with passed options", () => {
			let options = { production: true };
			let connection = Connection(options);

			expect(fakes.config).to.be.calledWith(options);
		});

		describe("EndpointManager instance", function() {
			it("is created", () => {
				Connection();

				expect(fakes.EndpointManager).to.be.calledOnce;
				expect(fakes.EndpointManager).to.be.calledWithNew;
			});

			it("is passed the prepared configuration", () => {
				const returnSentinel = { "configKey": "configValue"};
				fakes.config.returns(returnSentinel);

				Connection({});
				expect(fakes.EndpointManager).to.be.calledWith(returnSentinel);
			});
		});
	});

	describe("pushNotification", () => {

		beforeEach(() => {
			fakes.config.returnsArg(0);
			fakes.endpointManager.getStream = sinon.stub();

			fakes.EndpointManager.returns(fakes.endpointManager);
		});

		context("a single stream is available", () => {

			context("a single token is passed", () => {
				let promise;

				context("transmission succeeds", () => {
					beforeEach( done => {
						const connection = new Connection( { address: "testapi" } );

						fakes.stream = new FakeStream("abcd1234", 200);
						fakes.endpointManager.getStream.onCall(0).returns(fakes.stream);

						promise = connection.pushNotification(notificationDouble(), "abcd1234");
						promise.then( () => done(), done );
					});

					it("attempts to acquire one stream", () => {
						expect(fakes.endpointManager.getStream).to.be.calledOnce;
					});

					it("sends the required headers", () => {
						expect(fakes.stream.headers).to.be.calledWithMatch( {
							":scheme": "https",
							":method": "POST",
							":authority": "testapi",
							":path": "/3/device/abcd1234",
							"content-length": Buffer.byteLength(notificationDouble().compile()),
						});
					});

					it("writes the notification data to the pipe", () => {
						expect(fakes.stream._transform).to.be.calledWithMatch(actual => actual.equals(Buffer(notificationDouble().compile())));
					});

					it("ends the stream", () => {
						expect(() => fakes.stream.write("ended?")).to.throw("write after end");
					});

					it("resolves with the device token in the success array", () => {
						return expect(promise).to.become([[{"device": "abcd1234"}], []]);
					});
				});

				context("error occurs", () => {
					let promise;

					beforeEach(() => {
						const connection = new Connection( { address: "testapi" } );

						fakes.stream = new FakeStream("abcd1234", 400, { "reason" : "BadDeviceToken" });
						fakes.endpointManager.getStream.onCall(0).returns(fakes.stream);

						promise = connection.pushNotification(notificationDouble(), "abcd1234");
					});

					it("resolves with the device token, status code and response in the failed array", () => {
						return expect(promise).to.eventually.deep.equal([[], [{"device": "abcd1234", "status": 400, "response": { "reason" : "BadDeviceToken" }}]])
					});
				});
			});

			context("no new stream is returned but the endpoint later wakes up", () => {
				let promise

				beforeEach( done => {
					const connection = new Connection( { address: "testapi" } );

					fakes.stream = new FakeStream("abcd1234", 200);
					fakes.endpointManager.getStream.onCall(0).returns(null);
					fakes.endpointManager.getStream.onCall(1).returns(fakes.stream);
					let promise = connection.pushNotification(notificationDouble(), "abcd1234");

					expect(fakes.stream.headers).to.not.be.called;

					fakes.endpointManager.emit("wakeup");

					promise.then( () => done(), done );
				});

				it("sends the required headers to the newly available stream", () => {
					expect(fakes.stream.headers).to.be.calledWithMatch( {
						":scheme": "https",
						":method": "POST",
						":authority": "testapi",
						":path": "/3/device/abcd1234",
						"content-length": Buffer.byteLength(notificationDouble().compile()),
					});
				});

				it("writes the notification data to the pipe", () => {
					expect(fakes.stream._transform).to.be.calledWithMatch(actual => actual.equals(Buffer(notificationDouble().compile())));
				});
			});
		});

		context("when 5 tokens are passed", () => {

			beforeEach(() => {
					fakes.streams = [
						new FakeStream("abcd1234", 200),
						new FakeStream("adfe5969", 400, { reason: "MissingTopic" }),
						new FakeStream("abcd1335", 410, { reason: "BadDeviceToken", timestamp: 123456789 }),
						new FakeStream("bcfe4433", 200),
						new FakeStream("aabbc788", 413, { reason: "PayloadTooLarge" }),
					];
			});

			context("streams are always returned", () => {
				let promise;

				beforeEach( done => {
					const connection = new Connection( { address: "testapi" } );

					fakes.endpointManager.getStream.onCall(0).returns(fakes.streams[0]);
					fakes.endpointManager.getStream.onCall(1).returns(fakes.streams[1]);
					fakes.endpointManager.getStream.onCall(2).returns(fakes.streams[2]);
					fakes.endpointManager.getStream.onCall(3).returns(fakes.streams[3]);
					fakes.endpointManager.getStream.onCall(4).returns(fakes.streams[4]);

					promise = connection.pushNotification(notificationDouble(), ["abcd1234", "adfe5969", "abcd1335", "bcfe4433", "aabbc788"])
					promise.then( () => done(), done);
				});

				it("sends the required headers for each stream", () => {
					expect(fakes.streams[0].headers).to.be.calledWithMatch( { ":path": "/3/device/abcd1234" } );
					expect(fakes.streams[1].headers).to.be.calledWithMatch( { ":path": "/3/device/adfe5969" } );
					expect(fakes.streams[2].headers).to.be.calledWithMatch( { ":path": "/3/device/abcd1335" } );
					expect(fakes.streams[3].headers).to.be.calledWithMatch( { ":path": "/3/device/bcfe4433" } );
					expect(fakes.streams[4].headers).to.be.calledWithMatch( { ":path": "/3/device/aabbc788" } );
				});

				it("writes the notification data for each stream", () => {
					fakes.streams.forEach( stream => {
						expect(stream._transform).to.be.calledWithMatch(actual => actual.equals(Buffer(notificationDouble().compile())));
					});
				});

				it("resolves with the successful notifications", () => {
					return promise.then( response => {
						expect(response[0]).to.deep.equal([{device: "abcd1234"}, {device: "bcfe4433"}]);
					});
				});

				it("resolves with the device token, status code and response of the unsuccessful notifications", () => {
					return promise.then( response => {
						expect(response[1]).to.deep.equal([
							{ device: "adfe5969", status: 400, response: { reason: "MissingTopic" }},
							{ device: "abcd1335", status: 410, response: { reason: "BadDeviceToken", timestamp: 123456789 }},
							{ device: "aabbc788", status: 413, response: { reason: "PayloadTooLarge" }},
						]);
					});
				});
			});
		
			context("some streams return, others wake up later", () => {
				let promise;

				beforeEach( done => {
					const connection = new Connection( { address: "testapi" } );

					fakes.endpointManager.getStream.onCall(0).returns(fakes.streams[0]);
					fakes.endpointManager.getStream.onCall(1).returns(fakes.streams[1]);

					promise = connection.pushNotification(notificationDouble(), ["abcd1234", "adfe5969", "abcd1335", "bcfe4433", "aabbc788"])
					promise.then( () => done(), done);

					setTimeout(() => {
						fakes.endpointManager.getStream.reset();
						fakes.endpointManager.getStream.onCall(0).returns(fakes.streams[2]);
						fakes.endpointManager.getStream.onCall(1).returns(fakes.streams[3]);
						fakes.endpointManager.getStream.onCall(2).returns(fakes.streams[4]);
						fakes.endpointManager.emit("wakeup");
					}, 5);
				});

				it("sends the correct device ID for each stream", () => {
					expect(fakes.streams[0].headers).to.be.calledWithMatch({":path": "/3/device/abcd1234"});
					expect(fakes.streams[1].headers).to.be.calledWithMatch({":path": "/3/device/adfe5969"});
					expect(fakes.streams[2].headers).to.be.calledWithMatch({":path": "/3/device/abcd1335"});
					expect(fakes.streams[3].headers).to.be.calledWithMatch({":path": "/3/device/bcfe4433"});
					expect(fakes.streams[4].headers).to.be.calledWithMatch({":path": "/3/device/aabbc788"});
				});

				it("writes the notification data for each stream", () => {
					fakes.streams.forEach( stream => {
						expect(stream._transform).to.be.calledWithMatch(actual => actual.equals(Buffer(notificationDouble().compile())));
					});
				});

				it("resolves with the successful notifications", () => {
				});
				it("resolves with the device token, status code and response of the unsuccessful notifications", () => {
				});
			});
		});
	});
});

function notificationDouble() {
	return {
		payload: { aps: { badge: 1 } },
		topic: "io.apn.node",
		compile: function() { return JSON.stringify(this.payload); }
	};
}

function FakeStream(deviceId, statusCode, response) {
	const fakeStream = new stream.Transform({
		transform: sinon.spy(function(chunk, encoding, callback) {
			expect(this.headers).to.be.calledOnce;

			const headers = this.headers.firstCall.args[0];
			expect(headers[":path"].substring(10)).to.equal(deviceId);

			this.emit("headers", {
				":status": statusCode
			});
			callback(null, new Buffer(JSON.stringify(response) || ""));
		})
	});
	fakeStream.headers = sinon.stub();

	return fakeStream;
}