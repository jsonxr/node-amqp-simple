var assert = require('assert');
var async = require('async');
var amqp = require('../src');


describe("amqp-simple - callback API", function () {
  
  var connection;

  before(function (done) {
    connection = new amqp.Connection({ 
      url: 'amqp://dockerhost'
    });
    connection.open(function (err) {
      done(err);
    });
  });
  
  // after(function (done) {
  //   if (connection) {
  //     connection.close(function () {
  //       done();
  //     });
  //   }
  // })
  
  function getRoutingKey() {
    var routingKey = 'example' + (new Date).getTime();
    return routingKey;
  }
   
  it("should send/receive a message", function (done) {
    var routingKey = getRoutingKey();
    connection.subscribe({
      routingKey: routingKey,
      consumer: 'consumer',
      handler: function (msg, callback) {
        if (msg.body.one === 'one') {
          done();
        } else {
          done('body.one != "one"');
        }
        callback(); // Handle so it doesn't reque
      }
    }, function () {
      connection.publish({
        routingKey: routingKey,
        body: {
          one: 'one'
        }
      });
      
    });
  });
  
  it("should receive many calls to subscriber", function (done) {
    this.timeout(60000);
    var routingKey = getRoutingKey();
    var count = 0;
    connection.subscribe({
      routingKey: routingKey,
      consumer: 'consumer2',
      handler: function (msg, callback) {
        count++;
        if (count === 100) {
          done();
        }
        callback();
      }
    }, function () {
      for (var i = 0; i < 1000; i++) {
        connection.publish({
          routingKey: routingKey,
          body: { count: i }
        });
      }
      
    });
  });

  it("should retry when callback sends an error", function (done) {
    var routingKey = getRoutingKey();
    var count = 0;
    connection.subscribe({
      routingKey: routingKey,
      consumer: 'consumer3',
      handler: function (msg, callback) {
        count = count + 1;
        if (msg.headers['x-retry-count'] === 0) {
          callback();
          if (count === 2) {
            // count equals initial request plus 2 retries
            done();
          } else {
            done('retries do not match.');
          }
        } else {
          callback({ message: 'oops'});
        }
      }
    }, function () {
      connection.publish({
        routingKey: routingKey,
        body: {
          two: 'two'
        },
        headers: {
          'x-retry-count': 1,
          'x-retry-delay-ms': 250
        }
      });
      
    });
  });

  it("should retry when an exception is thrown in a handler", function (done) {
    var routingKey = getRoutingKey();
    var count = 0;
    connection.subscribe({
      routingKey: routingKey,
      consumer: 'consumer4',
      handler: function (msg, callback) {
        if (msg.headers['x-retry-count'] === 0) {
          callback();
          if (count === 2) {
            // count equals initial request plus 2 retries
            done();
          } else {
            done('Expected 1 retry, counted ' + count);
          }
        } else {
          count = count + 1;
          throw new Error("exception in handler");
        }
      }
    }, function () {
      connection.publish({
        routingKey: routingKey,
        body: {
          two: 'two'
        },
        headers: {
          'x-retry-count': 2,
          'x-retry-delay-ms': 250
        }
      });
      
    });
  });

  it("should retry when timeout is reached in a handler", function (done) {
    var routingKey = getRoutingKey();
    var count = 0;
    connection.subscribe({
      routingKey: routingKey,
      consumer: 'consumer5',
      timeout: 100,
      handler: function (msg, callback) {
        if (msg.headers['x-retry-count'] === 0) {
          if (count === 2) {
            // count equals initial request plus 2 retries
            done();
          } else {
            done('Expected 1 retry, counted ' + count);
          }
        } else {
          count = count + 1;
          setTimeout(callback, 1000);
        }
      }
    }, function () {
      connection.publish({
        routingKey: routingKey,
        body: {
          two: 'two'
        },
        headers: {
          'x-retry-count': 2,
          'x-retry-delay-ms': 250
        }
      });
      
    });
  });
      
  it("should receive on multiple subscribers", function (done) {
    var routingKey = getRoutingKey();
    var a = false;
    var b = false;
    
    async.series([
      function (cb) {
        connection.subscribe({
          routingKey: routingKey,
          consumer: 'consumer6',
          handler: function (msg, callback) {
            callback(); // Handle so it doesn't reque
            a = true;
            if (a && b) {
              done();
            }
          }
        }, cb);
      },

      function (cb) {
        connection.subscribe({
          routingKey: routingKey,
          consumer: 'consumer7',
          handler: function (msg, callback) {
            callback(); // Handle so it doesn't reque
            b = true;
            if (a && b) {
              done();
            }
          }
        }, cb);
      },
      
    ], function (err) {
      // Only publish after both subscribers are done
      connection.publish({
        routingKey: routingKey,
        body: {
          name: 'three'
        }
      });
    });
    
  });

  it("should move to dead queue when fails", function (done) {
    var routingKey = getRoutingKey();
    var deadKey = routingKey + '.dead';
    var state = 'start';

    var count = 0;
    connection.subscribe({
      routingKey: routingKey,
      consumer: 'consumer5',
      handler: function (msg, callback) {
        throw new Error("exception in handler");
      },
      dead: function (msg, callback) {
        assert.equal(msg.body.two, 'two');
        callback();
        done();
      }
    }, function () {
      state = 'start';
      connection.publish({
        routingKey: routingKey,
        body: {
          two: 'two'
        },
        headers: {
          'x-retry-count': 0,
          'x-retry-delay-ms': 50
        }
      });
      
    });
  });

  it("should retry dead messages", function (done) {
    var routingKey = getRoutingKey();
    var deadKey = routingKey + '.dead';
    var state = 'dead';

    var count = 0;
    
    function publishDead(callback) {
      // Publish a message that dies!
      connection.subscribe({
        routingKey: routingKey,
        consumer: 'test-dead',
        handler: function (msg, cb) {
          callback();
          throw new Error("exception in handler");
        }
      }, function () {
        state = 'start';
        connection.publish({
          routingKey: routingKey,
          body: {
            two: 'two'
          },
          headers: {
            'x-retry-count': 0,
            'x-retry-delay-ms': 50
          }
        });
      });
    }
    
    publishDead(function () {
      connection.subscribe({
        routingKey: routingKey,
        consumer: 'test-dead',
        dead: function (msg, callback) {
          console.log('dead received! ', msg);
          assert.equal(msg.body.two, 'two');
          callback();
          done();
        }
      }, function () {
        // ?
      });
    })
  });
  
});


