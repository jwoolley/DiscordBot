var Promise = require('bluebird');
var fs = require('fs');

var qs = require("querystring");
var d20 = require("d20");
var htmlToText = require('html-to-text');

var MongoDb = require('./lib/mongo.js');
var utils = require('./lib/utils');

var Request = require('request').defaults({jar: true});
  
var MtgNewsBot = require('mtgnewsbot');

var http = require('http');
http.createServer(function(request, response) {
  response.writeHead(200, {"Content-Type": "text/plain"});
  response.write("Hello from the magic tavern!");
  response.end();
}).listen(process.env.PORT || 8888);

try {
  var Discord = require("discord.js");
} catch (e){
  console.log(e.stack);
  console.log(process.version);
  console.log("Please run npm install and ensure it passes with no errors!");
  process.exit();
}

var globals = {
  config: {},
  chatData: {},
  db: {}
};

var log = {
  debug: function(msg) { if (globals.config.server.debug) { console.log(msg); } },
  info: function(msg) { console.log(msg); },
  warn: function(msg) { console.log(msg); },  
  error: function(msg) { console.log(msg); },  
  ignore: function(msg) {}
};

var configs = ['server', 'auth', 'permissions', 'dieroll', 'config', 'forum'];
Promise.all(configs.map(config => loadConfig(config))).then(() => { 

  // Get authentication data
  var AuthDetails = globals.config.auth;

  // Load custom permissions
  var Permissions = globals.config.permissions;

  Permissions.checkPermission = function (user,permission) {
    try {
      var allowed = false;
      try{
        if(Permissions.global.hasOwnProperty(permission)){
          allowed = Permissions.global[permission] == true;
        }
      } catch(e){}
      try{
        if(Permissions.users[user.id].hasOwnProperty(permission)){
          allowed = Permissions.users[user.id][permission] == true;
        }
      } catch(e){}
      return allowed;
    } catch(e){}
    return false;
  }

  //load config data
  var Config = globals.config.config;
  if (Config === undefined) {
    Config = {
      debug: false,
      respondToInvalid: false
    }
  }

  var startTime = Date.now();

  var initDieRollData = function(mongo, collection) {
    //TODO: these function definitions don't belong in this init call. move everything out into a separate dieroll module
    globals.chatData.dieRolls = {
      getLowRoll: function(table, size) {
        return table.filter(roll => roll.sides == size)
          .reduce((lowest, current) => { 
            if (lowest.value === undefined || current.value < lowest.value) {
              lowest = current;
            }
            return lowest;
          }, {});
      },
      getHighRoll: function(table, size) {
        return table.filter(roll => roll.sides == size)
          .reduce((highest, current) => { 
            if (highest.value === undefined || current.value > highest.value) {
              highest = current;
            }
            return highest;
          }, {});
      },
      handleDieRolls: function(results, numSides, channel, userId, originalMessageAuthor, originalMessageBody) {
        log.ignore('handleDieRolls | results: ' + results + '; numSides: ' + numSides + '; channel: ' + channel + '; userId: ' + userId);

        if (globals.config.dieroll.matches.map(match => match.sides).indexOf(parseInt(numSides)) === -1 || channel === undefined || userId === undefined) { return; }

        if (!globals.db.mongo.hasOpenConnection) {
          console.log('No open mongodb connection. Skipping die roll handling.');
          return;
        }

        if (!globals.chatData.dieRolls[numSides]) {
          globals.chatData.dieRolls[numSides] = {};
        }

        var numDice = results.length;

        var timestamp = Date.now();

        var records = results.map(result => {
          return {
            value: result,
            sides: numSides,
            user: userId.toString(),
            time: timestamp
          };
        });

        log.info('Inserting ' + records.length + ' rolls with ' + numSides + ' sides for user: ' + userId.toString());

        try {
          globals.db.mongo.insertMany(globals.config.dieroll.mongo.collection, records);

          globals.chatData.dieRolls[numSides].highest = globals.chatData.dieRolls[numSides].highest ? globals.chatData.dieRolls[numSides].highest : 0;
          globals.chatData.dieRolls[numSides].lowest = globals.chatData.dieRolls[numSides].lowest ? globals.chatData.dieRolls[numSides].lowest: Number.MAX_SAFE_INTEGER;

          // JACKPOT ROLL (MIN/MAX POSSIBLE ROLL)
          var targets = [1, parseInt(numSides)];

          var matches = targets.filter(target => { 
            return results.indexOf(target) !== -1;
          });
          var matchConfig = globals.config.dieroll.matches.find(match => match.sides == numSides);

          matches.forEach(match => { 
            var user = getUser(userId, channel);
            bot.sendMessage(channel, '🎲 🎲 🎲 Rolled a **' + match + '** on ' + results.length + ' d' + numSides + (numDice > 1 ? 's' : '') + '! 🎲 🎲 🎲');
            var originalMessage = originalMessageBody.substr(0);
            var rollRegex = new RegExp('(^|\\W)(' + match + ')($|\\W)');
            originalMessage = originalMessage.replace(rollRegex, "$1[b]$2[/b]$3");
            originalMessage = originalMessage.replace(/:game_die:/g, '🎲');

            originalMessage = originalMessage.replace(/<@(\d+)>/, function(match, p1) { return getUser(p1, channel).username; });
            var forumPostMessage = ':alarm:  :alarm:  :alarm:  :alarm:  :alarm:  :alarm:';
            forumPostMessage += '\n\na winner has been decided ...';
            forumPostMessage += '\n\n[b]' + user.username + '[/b] has thrown the winning roll!';
            forumPostMessage += '\n\nThe winner of the great d' + numSides + ' battle is...';        
            forumPostMessage +=  '\n\n[spoiler]';
            forumPostMessage += '[quote="' + originalMessageAuthor + '"]';
            forumPostMessage += originalMessage;
            forumPostMessage += '[/quote]';    
            forumPostMessage += '\n:pmoparty: :pmoparty: :pmoparty: :pmoparty: :pmoparty:\n:pmoparty: :pmoparty: :pmoparty: :pmoparty: :pmoparty:\n:pmoparty: :pmoparty: :pmoparty: :pmoparty: :pmoparty:';
            forumPostMessage += '\n[img]' + (match === 1 ? matchConfig.images.min : matchConfig.images.max) + '[/img]';
            forumPostMessage += '\n:pmoparty: :pmoparty: :pmoparty: :pmoparty: :pmoparty:\n:pmoparty: :pmoparty: :pmoparty: :pmoparty: :pmoparty:\n:pmoparty: :pmoparty: :pmoparty: :pmoparty: :pmoparty:';
            forumPostMessage += '\n\n[youtube]https://www.youtube.com/watch?v=3GwjfUFyY6M[/youtube]';
            forumPostMessage += '\n\n' + match + ' is the best number! Well, played everybody![/spoiler]';
            forumPostMessage += '\n\n:alarm:  :alarm:  :alarm:  :alarm:  :alarm:  :alarm:';

            globals.forum.goodgamery.post('dieRolls', forumPostMessage);
          });

          // HISTORICAL HIGH OR LOW ROLL
          var sorted = results.sort((a,b) => a - b);
          var lowest = sorted[0];
          var highest = sorted[sorted.length - 1];

          log.ignore('Lowest: ' + lowest + ', Highest: ' + highest);
          log.ignore('Global lowest: ' + globals.chatData.dieRolls[numSides].lowest + ', Global highest: ' + globals.chatData.dieRolls[numSides].highest);

          if (lowest < globals.chatData.dieRolls[numSides].lowest) {
            var previousLowest = globals.chatData.dieRolls[numSides].lowest;
            globals.chatData.dieRolls[numSides].lowest = lowest;
            bot.sendMessage(channel, 
            '🎲 Record broken for the lowest recorded d' + numSides + ' roll! Rolled a **' + lowest + '**. Previous low: ' + previousLowest + ' 🎲');

            var rollRegex = new RegExp('(^|\\W)(' + lowest + ')($|\\W)');
            var originalMessage = originalMessageBody.substr(0);            
            originalMessage = originalMessage.replace(rollRegex, "$1[b]$2[/b]$3");
            originalMessage = originalMessage.replace(/:game_die:/g, '🎲');

            originalMessage = originalMessage.replace(/<@(\d+)>/, function(match, p1) { return getUser(p1, channel).username; });
            var forumPostMessage = 'The record for the lowest die roll has been broken!' 
            forumPostMessage += '\n\n[quote="' + originalMessageAuthor + '"]';
            forumPostMessage += originalMessage;
            forumPostMessage += '[/quote]';
            forumPostMessage += '\nNew lowest roll: [b]' + lowest + '[/b]';

            globals.forum.goodgamery.post('dieRolls', forumPostMessage);
          }
          if (highest > globals.chatData.dieRolls[numSides].highest) {          
            var previousHighest = globals.chatData.dieRolls[numSides].highest;
            globals.chatData.dieRolls[numSides].highest = highest;
            bot.sendMessage(channel, 
            '🎲 Record broken for the highest recorded d' + numSides + ' roll! Rolled a **' + highest + '**. Previous high: ' + previousHighest + ' 🎲');

            var rollRegex = new RegExp('(^|\\W)(' + highest + ')($|\\W)');
            var originalMessage = originalMessageBody.substr(0);            

            originalMessage = originalMessage.replace(rollRegex, "$1[b]$2[/b]$3");
            originalMessage = originalMessage.replace(/:game_die:/g, '🎲');
            originalMessage = originalMessage.replace(/<@(\d+)>/, function(match, p1) { return getUser(p1, channel).username; });

            var forumPostMessage = 'The record for the highest die roll has been broken!' 
            forumPostMessage += '\n\n[quote="' + originalMessageAuthor + '"]';
            forumPostMessage += originalMessage;
            forumPostMessage += '[/quote]';
            forumPostMessage += '\nNew highest roll: [b]' + highest + '[/b]';

            globals.forum.goodgamery.post('dieRolls', forumPostMessage);
          }              
        } catch (e) {
          log.error('Error saving dieroll data: ' + e);
        }
      }
    };

    globals.config.dieroll.matches.forEach(entry => {      
      var size = entry.sides;
      globals.chatData.dieRolls[size] = { lowest: size, highest: 1 };

      if (mongo) {
        return mongo.dumpTable(collection).then(result => { this.allRolls = result; log.ignore('table: ' + utils.node.inspect(result)); })
          .then(() => globals.chatData.dieRolls.getLowRoll(this.allRolls, size)).then(lowest => { log.ignore('lowest roll: ' + lowest.value); globals.chatData.dieRolls[size].lowest = lowest.value; })
          .then(() => globals.chatData.dieRolls.getHighRoll(this.allRolls, size)).then(highest => { log.ignore('highest roll: ' + highest.value);  globals.chatData.dieRolls[size].highest = highest.value; })      
          .catch(e => log.info('e: ' + e));
      }
    });
  };

  globals.db.mongo = new MongoDb(globals.config.dieroll.mongo.host,
    globals.config.dieroll.mongo.port, globals.config.dieroll.mongo.db);

  globals.db.mongo.open()
    .then(mongo => initDieRollData(mongo, globals.config.dieroll.mongo.collection), e => log.error('Could not open mongodb: ' + e));

  globals.forum = (function() {
    var loginToGoodGamery = function(username, password) {
      const loginConfirmationMessage = 'You have been successfully logged in';

      var opts = {
        url: 'https://forums.goodgamery.com/ucp.php',
        qs: { mode: 'login' },
        method: 'POST',

        form: {
            username: username,
            password: password,
            viewonline: 'on',
            redirect: 'index.php',
            login: 'Login',
            redirect: './ucp.php?mode=login'
        }
      };

      return new Promise(function(resolve, reject) {
        return request(opts)
          .then((response) => {
            //TODO: check cookies instead, if that's sufficient
            if (response.body.indexOf(loginConfirmationMessage) !== -1) {
              console.log('successfully logged in');
              resolve();
            } else {
              console.log('login failed. body: ' + response.body);
              reject(new Error('Did not receive expected response after login request. Response body: ' + response.body));
            }
          });
        });
    };

    var makePost = function(forumId, threadId, message) {
      log.debug('Making post to thread ' + threadId + ' in forum ' + forumId);
      return new Promise(function(resolve, reject) {
        try {
          const postPageOpts = {
            url : 'https://forums.goodgamery.com/posting.php',
            qs: {
              mode: 'reply',
              f: forumId,
              t: threadId
            },
            method: 'GET'
          };

          return request(postPageOpts)
            .then(response => {

              var token = undefined;
              var timestamp = undefined;

              var tokenMatch = response.body.match(/name="form_token"\s+value="([\w]+)"/);
              if (tokenMatch) { token = tokenMatch[1]; }

              var timestampMatch = response.body.match(/name="creation_time"\s+value="(\d+)"/);
              if (timestampMatch) { timestamp = timestampMatch[1]; }

              if (token && timestamp) {
                return { token : token, timestamp: timestamp };
              } else {
                reject('Did not receive expected response for posting page: ' + response);
              }
            })
            .then(postPageData => { 
              var token  = postPageData.token;
              var timestamp = postPageData.timestamp;

              var opts = {
                url : 'https://forums.goodgamery.com/posting.php',
                qs: {
                 mode: 'reply',
                 f: forumId,
                 t: threadId
               },
               method: 'POST',
               form: {
                message: message,
                post: 'Submit',
                form_token: token,
                creation_time: timestamp
               }
             };

             return request(opts)
              .then(undefined, response => log.warn('UNABLE TO POST MESSAGE. HTTP RESPONSE CODE: ' + response.code + ' RESPONSE BODY:\n' + response.body));
            });
          } catch (e) { reject (e); }
        });
    };

    return {
      goodgamery: {
        login: loginToGoodGamery,
        post: function(threadKey, message) {
          var forumConfig = globals.config.forum && globals.config.forum.goodgamery;
          if (!forumConfig) {
            log.error('Could not make post. Config globals.config.forum.goodgamery not found.');
            return Promise.resolve(); 
          }

          var authInfo = forumConfig.authentication;

          if (!authInfo || !authInfo.username || !authInfo.password) {
            log.error('Could not make post. Config globals.config.forum.goodgamery.authentication did not have entries for username and/or password.');
            return Promise.resolve(); 
          }

          var threadInfo = forumConfig.threads ? forumConfig.threads[threadKey] : undefined;

          if (!threadInfo || !threadInfo.threadId || !threadInfo.forumId) {
            log.error('Could not make post. Config globals.config.forum.goodgamery.threads did not have valid entry for thread key: ' + threadKey);
            return Promise.resolve(); 
          }

          if (threadInfo && threadInfo.threadId & threadInfo.forumId) {
            return loginToGoodGamery(authInfo.username, authInfo.password)
             .then(() => makePost(threadInfo.forumId, threadInfo.threadId, message));
          }
        }
      }
    }
  })();


  var giphy_config = {
      "api_key": "dc6zaTOxFJmzC",
      "rating": "r",
      "url": "http://api.giphy.com/v1/gifs/random",
      "permission": ["NORMAL"]
  };

  //https://api.imgflip.com/popular_meme_ids
  var meme = {
    "brace": 61546,
    "mostinteresting": 61532,
    "fry": 61520,
    "onedoesnot": 61579,
    "yuno": 61527,
    "success": 61544,
    "allthethings": 61533,
    "doge": 8072285,
    "drevil": 40945639,
    "skeptical": 101711,
    "notime": 442575,
    "yodawg": 101716
  };

  // USER POST MATCHING PATTERNS 
  var messagePatterns = {
    tableFlip: {
      "flip": '(╯°□°）╯︵ ┻━┻',
      "unflip": '┬─┬ノ( º _ ºノ)',
      "sad": '┻━┻ /(o;︵ o;\\\\\\)'
    }
  };

  // BEETLEJUICE MODE
  // TODO: move to separate file
  var avatars = {
   baggle: 'http://i.imgur.com/IA6t2Uc.png',
   beetlejuice: 'http://i.imgur.com/WIYwjlU.jpg'
  };

  var beetlejuiceCount = 0;

  var beetlejuiceMessages = {
    beetlejuice: [
      "I attended Juilliard... I'm a graduate of the Harvard business school. I travel quite extensively. I lived through the Black Plague and had a pretty good time during that. I've seen the EXORCIST ABOUT A HUNDRED AND SIXTY-SEVEN TIMES, AND IT KEEPS GETTING FUNNIER EVERY SINGLE TIME I SEE IT... NOT TO MENTION THE FACT THAT YOU'RE TALKING TO A DEAD GUY... NOW WHAT DO YOU THINK? You think I'm qualified?",
      "I'm feeling a little, ooh, anxious if you know what I mean. It's been about six hundred years after all. I wonder where a guy, an everyday Joe like myself, can find a little *action*.",
      "I'll eat anything you want me to eat. I'll swallow anything you want me to swallow. But, come on down and I'll... chew on a dog! Arroooo!"
    ],
    worried: [
      "Ah. Oh-oh-oh. Ah-ah. Nobody says the 'B' word.",
      "Uh. Hm. Let me stop you right there."
    ],
    banished: [
      'Whoa, hey! What are you doing? Hey, stop it! Hey, you\'re messing up my hair! C\'mon! Whoa! Whoa! Stop it! Whoa!',
      "Hope you like Italian. Hey where are ya going? Ah come on where'd ya go? Come on, you have to work with me here, I'm just trying to cut you a deal. What do ya want me to do? Where are ya? YOU BUNCH OF LOSERS! YOU'RE WORKING WITH A PROFESSIONAL HERE!"
    ],
    done: [
      'Hey, this might be a good look for me.',
      "Don't you hate it when that happens?"
    ]
  };

  var aliases;
  var messagebox;

  var commandList;

  var commands = {
    "testAttach": {
      description: "uploads a thing. maybe.",
      process: function(bot, msg, suffix) {
        const fullPath = require('path').resolve('./tmp/dd729d3b-32a8-4c5d-87ee-9f2b08952569.png');
        console.log('attempting to attach: ' + fullPath);
        bot.sendMessage(msg.channel, 'file://' + fullPath);
      }
    },
    "gif": {
      usage: "<image tags>",
          description: "returns a random gif matching the tags passed",
      process: function(bot, msg, suffix) {
          var tags = suffix.split(" ");
          get_gif(tags, function(id) {
        if (typeof id !== "undefined") {
            bot.sendMessage(msg.channel, "http://media.giphy.com/media/" + id + "/giphy.gif [Tags: " + (tags ? tags : "Random GIF") + "]");
        }
        else {
            bot.sendMessage(msg.channel, "Invalid tags, try something different. [Tags: " + (tags ? tags : "Random GIF") + "]");
        }
          });
      }
    },
      "ping": {
          description: "responds pong, useful for checking if bot is alive",
          process: function(bot, msg, suffix) {
              bot.sendMessage(msg.channel, msg.sender+" pong!");
              if(suffix){
                  bot.sendMessage(msg.channel, "note that !ping takes no arguments!");
              }
          }
      },
      "servers": {
          description: "lists servers bot is connected to",
          process: function(bot,msg){bot.sendMessage(msg.channel,bot.servers);}
      },
      "channels": {
          description: "lists channels bot is connected to",
          process: function(bot,msg) { 
            bot.sendMessage(msg.channel,bot.channels); 
          }
      },
      "myid": {
          description: "returns the user id of the sender",
          process: function(bot,msg){bot.sendMessage(msg.channel,msg.author.id);}
      },
      "idle": {
          description: "sets bot status to idle",
          process: function(bot,msg){ bot.setStatusIdle();}
      },
      "online": {
          description: "sets bot status to online",
          process: function(bot,msg){ bot.setStatusOnline();}
      },
      "youtube": {
          usage: "<video tags>",
          description: "gets youtube video matching tags",
          process: function(bot,msg,suffix){
              youtube_plugin.respond(suffix,msg.channel,bot);
          }
      },
      "say": {
          usage: "<message>",
          description: "bot says message",
          process: function(bot,msg,suffix){
            bot.sendMessage(msg.channel,suffix);
          }
      },
      "puppet": {
        usage: "<channel message>",
        description: "bot repeats message in the specified channel",     
        process: function(bot,msg,suffix) { 
          var args = suffix.split(' ');
          var channelNameOrId = args.shift();
          var message = args.join(' ');

          var channel = findChannel(bot, msg, channelNameOrId);

          if (channel) {
            bot.sendMessage(channel, message);
          }
        }
      },
      "mtgheadlines": {
        description: "bot returns a list of randomly generated MTG headlines",
        process: function(bot,msg){
          const NUM_MTG_HEADLINES = 10;

          const getNormalizedDateString = function(date) {
            return date.toLocaleDateString('fullwide', { month: 'long', day: 'numeric', year: 'numeric' } );
          };

          const headlines = MtgNewsBot.generateHeadlines(NUM_MTG_HEADLINES);

          const message = headlines.reduce((list, headline) => {
            return list + '\n\n • ' + headline;
          }, '**Latest Magic: the Gathering News Headlines for ' + getNormalizedDateString(new Date()) + '**');
          console.log(message);

          bot.sendMessage(msg.channel,message);
        }
      },
    "announce": {
          usage: "<message>",
          description: "bot says message with text to speech",
          process: function(bot,msg,suffix){ bot.sendMessage(msg.channel,suffix,{tts:true});}
      },
      "pullanddeploy": {
          description: "bot will perform a git pull master and restart with the new code",
          process: function(bot,msg,suffix) {
              bot.sendMessage(msg.channel,"fetching updates...",function(error,sentMsg){
                  console.log("updating...");
                var spawn = require('child_process').spawn;
                  var log = function(err,stdout,stderr){
                      if(stdout){console.log(stdout);}
                      if(stderr){console.log(stderr);}
                  };
                  var fetch = spawn('git', ['fetch']);
                  fetch.stdout.on('data',function(data){
                      console.log(data.toString());
                  });
                  fetch.on("close",function(code){
                      var reset = spawn('git', ['reset','--hard','origin/master']);
                      reset.stdout.on('data',function(data){
                          console.log(data.toString());
                      });
                      reset.on("close",function(code){
                          var npm = spawn('npm', ['install']);
                          npm.stdout.on('data',function(data){
                              console.log(data.toString());
                          });
                          npm.on("close",function(code){
                              console.log("goodbye");
                              bot.sendMessage(msg.channel,"brb!",function(){
                                  bot.logout(function(){
                                      process.exit();
                                  });
                              });
                          });
                      });
                  });
              });
          }
      },
      "meme": {
          usage: 'meme "top text" "bottom text"',
          process: function(bot,msg,suffix) {
              var tags = msg.content.split('"');
              var memetype = tags[0].split(" ")[1];
              //bot.sendMessage(msg.channel,tags);
              var Imgflipper = require("imgflipper");
              var imgflipper = new Imgflipper(AuthDetails.imgflip_username, AuthDetails.imgflip_password);
              imgflipper.generateMeme(meme[memetype], tags[1]?tags[1]:"", tags[3]?tags[3]:"", function(err, image){
                  //console.log(arguments);
                  bot.sendMessage(msg.channel,image);
              });
          }
      },
      "memehelp": { //TODO: this should be handled by !help
          description: "returns available memes for !meme",
          process: function(bot,msg) {
              var str = "Currently available memes:\n"
              for (var m in meme){
                  str += m + "\n"
              }
              bot.sendMessage(msg.channel,str);
          }
      },
      "version": {
          description: "returns the git commit this bot is running",
          process: function(bot,msg,suffix) {
              var commit = require('child_process').spawn('git', ['log','-n','1']);
              commit.stdout.on('data', function(data) {
                  bot.sendMessage(msg.channel,data);
              });
              commit.on('close',function(code) {
                  if( code != 0){
                      bot.sendMessage(msg.channel,"failed checking git version!");
                  }
              });
          }
      },
      "log": {
          usage: "<log message>",
          description: "logs message to bot console",
          process: function(bot,msg,suffix){console.log(msg.content);}
      },
      "wiki": {
          usage: "<search terms>",
          description: "returns the summary of the first matching search result from Wikipedia",
          process: function(bot,msg,suffix) {
              var query = suffix;
              if(!query) {
                  bot.sendMessage(msg.channel,"usage: !wiki search terms");
                  return;
              }
              var Wiki = require('wikijs');
              new Wiki().search(query,1).then(function(data) {
                  new Wiki().page(data.results[0]).then(function(page) {
                      page.summary().then(function(summary) {
                          var sumText = summary.toString().split('\n');
                          var continuation = function() {
                              var paragraph = sumText.shift();
                              if(paragraph){
                                  bot.sendMessage(msg.channel,paragraph,continuation);
                              }
                          };
                          continuation();
                      });
                  });
              },function(err){
                  bot.sendMessage(msg.channel,err);
              });
          }
      },
      "join-server": {
          usage: "<invite>",
          description: "joins the server it's invited to",
          process: function(bot,msg,suffix) {
              console.log(bot.joinServer(suffix,function(error,server) {
                  console.log("callback: " + arguments);
                  if(error){
                      bot.sendMessage(msg.channel,"failed to join: " + error);
                  } else {
                      console.log("Joined server " + server);
                      bot.sendMessage(msg.channel,"Successfully joined " + server);
                  }
              }));
          }
      },
      "create": {
          usage: "<channel name>",
          description: "creates a new text channel with the given name.",
          process: function(bot,msg,suffix) {
              console.log('message: ' + msg);
              bot.createChannel(msg.channel.server,suffix,"text").then(function(channel) {
                  bot.sendMessage(msg.channel,"created " + channel);
              }).catch(function(error){
          bot.sendMessage(msg.channel,"failed to create channel: " + error);
        });
          }
      },
    "voice": {
      usage: "<channel name>",
      description: "creates a new voice channel with the give name.",
      process: function(bot,msg,suffix) {
              bot.createChannel(msg.channel.server,suffix,"voice").then(function(channel) {
                  bot.sendMessage(msg.channel,"created " + channel.id);
          console.log("created " + channel);
              }).catch(function(error){
          bot.sendMessage(msg.channel,"failed to create channel: " + error);
        });
          }
    },
      "delete": {
          usage: "<channel name>",
          description: "deletes the specified channel",
          process: function(bot, msg, suffix) {
            var channel = findChannel(bot, msg, suffix);
            if (!channel) { return; }
              bot.sendMessage(msg.channel.server.defaultChannel, "deleting channel " + suffix + " at " +msg.author + "'s request");
              if(msg.channel.server.defaultChannel != msg.channel){
                  bot.sendMessage(msg.channel,"deleting " + channel);
              }
              bot.deleteChannel(channel).then(function(channel) {
                console.log("deleted " + suffix + " at " + msg.author + "'s request");
              }).catch(function(error) {
                bot.sendMessage(msg.channel, "couldn't delete channel: " + error);
             });
          }
      },
      "avatar": {
        usage: "<avatar URL to set>",
        process: function(bot, msg, suffix) {
          var avatar = avatars[suffix];
          try{
            if (avatar) {
              log.debug("Setting avatar to " + suffix);
              bot.setAvatar(avatar);
            } else {
              bot.sendMessage(msg.channel, 'Avatar \'' + suffix + '\' not recognized.');
            }

        
          } catch(e){
            bot.sendMessage(msg.channel,
              "Couldn't set avatar from " + url + ". Error: " + e.stack);
          }
        }
      },
      "changename": {
        usage: "<avatar URL to set>",
        process: function(bot, msg, suffix) {
          var username = suffix;
          try{
            log.debug("Setting username to " + username);
            // TODO: validate URL
            var result = bot.setUsername(username);
          } catch(e){
            bot.sendMessage(msg.channel,
              "Couldn't set username to " + username + ". Error: " + e.stack);
          }
        }
      },

      "stock": {
          usage: "<stock to fetch>",
          process: function(bot,msg,suffix) {
              var yahooFinance = require('yahoo-finance');
              yahooFinance.snapshot({
                symbol: suffix,
                fields: ['s', 'n', 'd1', 'l1', 'y', 'r'],
              }, function (error, snapshot) {
                  if(error){
                      bot.sendMessage(msg.channel,"couldn't get stock: " + error);
                  } else {
                      //bot.sendMessage(msg.channel,JSON.stringify(snapshot));
                      bot.sendMessage(msg.channel,snapshot.name
                          + "\nprice: $" + snapshot.lastTradePriceOnly);
                  }  
              });
          }
      },
    "wolfram": {
      usage: "<search terms>",
          description: "gives results from wolframalpha using search terms",
          process: function(bot,msg,suffix){
          if(!suffix){
            bot.sendMessage(msg.channel,"Usage: !wolfram <search terms> (Ex. !wolfram integrate 4x)");
          }
                wolfram_plugin.respond(suffix,msg.channel,bot);
              }
    },
      "rss": {
          description: "lists available rss feeds",
          process: function(bot,msg,suffix) {
              /*var args = suffix.split(" ");
              var count = args.shift();
              var url = args.join(" ");
              rssfeed(bot,msg,url,count,full);*/
              bot.sendMessage(msg.channel,"Available feeds:", function(){
                  for(var c in rssFeeds){
                      bot.sendMessage(msg.channel,c + ": " + rssFeeds[c].url);
                  }
              });
          }
      },
      "reddit": {
          usage: "[subreddit]",
          description: "Returns the top post on reddit. Can optionally pass a subreddit to get the top psot there instead",
          process: function(bot,msg,suffix) {
              var path = "/.rss"
              if(suffix){
                  path = "/r/"+suffix+path;
              }
              rssfeed(bot,msg,"https://www.reddit.com"+path,1,false);
          }
      },
    "alias": {
      usage: "<name> <actual command>",
      description: "Creates command aliases. Useful for making simple commands on the fly",
      process: function(bot,msg,suffix) {
        var args = suffix.split(" ");
        var name = args.shift();
        if(!name){
          bot.sendMessage(msg.channel,"!alias " + this.usage + "\n" + this.description);
        } else if(commands[name] || name === "help"){
          bot.sendMessage(msg.channel,"overwriting commands with aliases is not allowed!");
        } else {
          var command = args.shift();
          aliases[name] = [command, args.join(" ")];
          //now save the new alias
          require("fs").writeFile("./alias.json",JSON.stringify(aliases,null,2), null);
          bot.sendMessage(msg.channel,"created alias " + name);
        }
      }
    },
    "userid": {
      usage: "[user to get id of]",
      description: "Returns the unique id of a user. This is useful for permissions.",
      process: function(bot,msg,suffix) {
        if(suffix){
          var users = msg.channel.server.members.getAll("username",suffix);
          if(users.length == 1){
            bot.sendMessage(msg.channel, "The id of " + users[0] + " is " + users[0].id)
          } else if(users.length > 1){
            var response = "multiple users found:";
            for(var i=0;i<users.length;i++){
              var user = users[i];
              response += "\nThe id of " + user + " is " + user.id;
            }
            bot.sendMessage(msg.channel,response);
          } else {
            bot.sendMessage(msg.channel,"No user " + suffix + " found!");
          }
        } else {
          bot.sendMessage(msg.channel, "The id of " + msg.author + " is " + msg.author.id);
        }
      }
    },
    "eval": {
      usage: "<command>",
      description: 'Executes arbitrary javascript in the bot process. User must have "eval" permission',
      process: function(bot,msg,suffix) {
        if(Permissions.checkPermission(msg.author,"eval")){
          bot.sendMessage(msg.channel, eval(suffix,bot));
        } else {
          bot.sendMessage(msg.channel, msg.author + " doesn't have permission to execute eval!");
        }
      }
    },
    "topic": {
      usage: "[topic]",
      description: 'Sets the topic for the channel. No topic removes the topic.',
      process: function(bot,msg,suffix) {
        bot.setChannelTopic(msg.channel,suffix);
      }
    },
    'enableCommand': {
      usage: "[command]",
      description: "enable a command for all users, if allowed",
      process: function(bot,msg,suffix) {
        var command = suffix;

        var msgResponse = '';

        if (!command) {
          return;
        } else if (!commandList[command]) {
          msgResponse = "Command '" + command + "' not recongized.";
        } else if (!commandList[command].hasConfigurablePermsissions) {
          msgResponse = "Command '" + command + "' can't be enabled.";
        } else {         
          commandList[command].permissions = commandList[command].permissions || [];            

          if (commandList[command].permissions.indexOf('all') == -1) {
            commandList[command].permissions.push('all');
            msgResponse =  "Command '" + command + "' enabled.";
          } else {
            msgResponse =  "Command '" + command + "' is already enabled.";
          }
        }
        bot.sendMessage(msg.channel, msgResponse);
      }  
    },
    'disableCommand': {
      usage: "[command]",
      description: "disable a command for all users, if allowed",      
      process: function(bot,msg,suffix) {
        var command = suffix;
        var msgResponse = '';

        if (!command) {
          return;
        } else if (!commandList[command]) {
          msgResponse = "Command '" + command + "' not recongized.";
        } else if (!commandList[command].hasConfigurablePermsissions) {
          msgResponse = "Command '" + command + "' can't be disabled.";
        } else {                   
          var perms = commandList[command].permissions;
          if (perms && perms.indexOf('all') !== -1) {
            perms.splice(perms.indexOf('all'), 1);
            msgResponse =  "Command '" + command + "' disabled."
          } else {
            msgResponse =  "Command '" + command + "' is already disabled."
          }
        }
        bot.sendMessage(msg.channel, msgResponse);
      }
    },
    // "roll": {
    //   usage: "[# of sides] or [# of dice]d[# of sides]( + [# of dice]d[# of sides] + ...)",
    //   description: "roll one die with x sides, or multiple dice using d20 syntax. Default value is 10",
    //   permissions: ['all'],
    //   hasConfigurablePermsissions: true,
    //   process: function(bot,msg,suffix) {
    //     if (suffix.split("d").length <= 1) {
    //       var numSides = suffix || 10;
    //       var roll = d20.verboseRoll(numSides);
    //       var rollMsg = msg.author + " rolled '" + suffix + "' for " + roll;
    //       bot.sendMessage(msg.channel, rollMsg, () => {
    //         setTimeout(function() {
    //           globals.chatData.dieRolls.handleDieRolls(roll, numSides, msg.channel, msg.author.id, bot.user.username, rollMsg);  
    //         }, 3000);
    //       });
    //     }  
    //     else {
    //       var match = suffix.match(/^\s*(\d+)?d(\d+)\s*/);
    //       if (match) {
    //         var numDice = match[1] ? match[1] : 1;
    //         var numSides = match[2];
         
    //         var rolls = d20.verboseRoll(suffix);
    //         var rollMsg = ":game_die: " + msg.author + " rolled '" + match[0] + "' for " + rolls;
    //         bot.sendMessage(msg.channel, rollMsg, () => {
    //           if (rolls && rolls.length > 0)
    //           setTimeout(function() {
    //             globals.chatData.dieRolls.handleDieRolls(rolls, numSides, msg.channel, msg.author.id, bot.user.username, rollMsg);  
    //           }, 3000);
    //         });
    //       } else {
    //         bot.sendMessage(msg.channel, msg.author + " :game_die: invalid die roll specified! :game_die:");
    //       }
    //     }
    //   }
    // },
    "username": {
      usage: "<userid>",
      description: "debugging ability to get user object from userid",
      process: function(bot, msg, suffix) {
        console.log('Called testUserId with "' + suffix + '"');
        var userId = suffix;
        try {
         var user = msg.channel.server.members.get("id", userId);
        } catch (e) { log.error(e); };
        log.debug('User: ' + user.username);
        bot.sendMessage(msg.channel, 'Oh, ' + user + '. That guy\'s a jerk.');
      }
    },
    "rollstats": {
      usage: "me | all",
      description: "show statistics about recorded die rolls",
      permissions: ['all'],
      process: function(bot, msg, suffix) {
        if (!globals.db.mongo.hasOpenConnection) {
          log.warn('No open mongodb connection. Rollstats not enabled.');
          return;
        }

        var getNormalizedDateString = function(date) {
          return date.toLocaleDateString('fullwide', { month: 'long', day: 'numeric', year: (date.getFullYear() === (new Date().getFullYear()) ? undefined : 'numeric') } );
        };

        // test with no roll data (and w/ no roll data for specificied size; pass in a bogus size)
        var aggregateRollStats = function(table, size) {                
          var aggregate = table.reduce((aggregate, current) => {
            if (aggregate.lowest === undefined || current.value < aggregate.lowest.value) {
              aggregate.lowest = current;
            }
            if (aggregate.highest === undefined || current.value > aggregate.highest.value) {
              aggregate.highest = current;
            }

            if (aggregate.oldest === undefined || current.time < aggregate.oldest.time) {
              aggregate.oldest = current;
            }

            if (aggregate.userRolls[current.user] === undefined) {
              aggregate.userRolls[current.user] = [];
            }

            aggregate.userRolls[current.user].push(current);
            return aggregate;
          }, { oldest: undefined, lowest: undefined, highest: undefined, userRolls: {} });

          var minRollsForAverage = 10;
          var userStats = Object.keys(aggregate.userRolls).reduce((userAggregate, user) => {
            var rolls = aggregate.userRolls[user];
            var averageRoll = rolls.reduce((total, roll) => total + roll.value, 0) / rolls.length;

            if (userAggregate.mostRolls === undefined || rolls.length > userAggregate.mostRolls.value) {
              userAggregate.mostRolls = { user: user, value: rolls.length };
            }
            if (userAggregate.lowestAverage === undefined || user.username != '**unknown user**' && rolls.length >= minRollsForAverage && averageRoll < userAggregate.lowestAverage.value) {
              userAggregate.lowestAverage = { user: user, value: averageRoll };
            }
            if (userAggregate.highestAverage === undefined || user.username != '**unknown user**' && rolls.length >= minRollsForAverage && averageRoll > userAggregate.highestAverage.value) {
              userAggregate.highestAverage = { user: user, value: averageRoll };
            }
            if (userAggregate.averageAverage === undefined || user.username != '**unknown user**' && rolls.length >= minRollsForAverage && Math.abs(size/2 - averageRoll) < Math.abs(size/2 - userAggregate.averageAverage.value)) {
              userAggregate.averageAverage = { user: user, value: averageRoll };
            }                  
            return userAggregate;
          }, { mostRolls: undefined, lowestAverage: undefined, highestAverage: undefined, averageAverage: undefined });
          return {
            oldest: aggregate.oldest,
            lowest: aggregate.lowest,
            highest: aggregate.highest,
            mostRolls: userStats.mostRolls,
            lowestAverage: userStats.lowestAverage,
            highestAverage: userStats.highestAverage,
            averageAverage: userStats.averageAverage,
            userStats: userStats,
            totalCount: table.length
          };
        };   

        var aggregateUserStats = function(table, userId, size) {
          log.ignore('Looking for d' + size + ' rolls for userId ' + userId + '...');
          var stats = table
            .filter(roll => roll.user === userId)
            .reduce((stats, current) => {
              stats.count++;
              stats.total += current.value;
              if (stats.lowest === undefined || current.value < stats.lowest.value) {
                stats.lowest = current;
              }           
              if (stats.highest === undefined || current.value > stats.highest.value) {
                stats.highest = current;
              }
              if (stats.oldest === undefined || current.time < stats.oldest.time) {
                stats.oldest = current;
              }
              return stats;                         
            }, { oldest: undefined, lowest: undefined, highest: undefined, count: 0 , total: 0 });
          var stats = {
            lowest: stats.lowest,
            highest: stats.highest,
            oldest: stats.oldest,
            count: stats.count,
            average: stats.count > 0 ? (stats.total / stats.count) : undefined
          };
          log.ignore('user roll stats: ' + JSON.stringify(stats));
          return stats;
        };

        globals.db.mongo.dumpTable(globals.config.dieroll.mongo.collection)  
          .then(allRolls => {
            log.ignore('globals.chatData.dieRolls: ' + JSON.stringify(globals.chatData.dieRolls, null, '\t'));

            Object.keys(globals.chatData.dieRolls).forEach(size => {
              if (isNaN(parseInt(size))) { return; } // TODO: put dieRoll records in a child property

              log.debug('Calculating roll stats for d' + size);            

              var rolls = allRolls.filter(roll => roll.sides == size);
              if (rolls.length === 0) { return; } 

              var statsMsg = undefined; 

              if (suffix === 'me') {
                var userId = msg.author.id;
                var stats = aggregateUserStats(rolls, userId, size);

                log.ignore('Roll stats: ' + JSON.stringify(stats, null, '\t'));

                if (stats.count === 0) {
                  statsMsg = '🎲 No d' + size +' rolls recorded for ' + getUser(userId, msg.channel) + ' 🎲';
                } else {
                  statsMsg = '🎲 Stats for all **d' + size + '** die rolls recorded for ' + getUser(userId, msg.channel) + ' 🎲';
                  statsMsg += '\n\n • ';
                  statsMsg += 'You have made **' + stats.count + '** rolls since ' + getNormalizedDateString(new Date(stats.oldest.time));                  
                  statsMsg += '\n\n • ';
                  statsMsg += 'Your lowest roll on record is **' + stats.lowest.value + '** on ' + getNormalizedDateString(new Date(stats.lowest.time));
                  statsMsg += '\n\n • ';
                  statsMsg += 'Your highest roll on record is **' + stats.highest.value + '** on ' + getNormalizedDateString(new Date(stats.highest.time));
                  statsMsg += '\n\n • ';
                  statsMsg += 'Your average roll is **' + Math.round(stats.average) + '**';
                }
              } else {
                var stats = aggregateRollStats(rolls, size);

                log.ignore('Roll stats: ' + JSON.stringify(stats, null, '\t'));

                statsMsg = '🎲 Stats for all recorded **d' + size + '** die rolls 🎲';
                statsMsg += '\n\n • ';
                statsMsg += 'Lowest roll on record is **' + stats.lowest.value + '** by ' + getUser(stats.lowest.user, msg.channel).username + ' on ' + getNormalizedDateString(new Date(stats.lowest.time));
                statsMsg += '\n\n • ';
                statsMsg += 'Highest roll on record is **' + stats.highest.value + '** by ' + getUser(stats.highest.user, msg.channel).username + ' on ' + getNormalizedDateString(new Date(stats.highest.time));
                statsMsg += '\n\n • ';
                statsMsg += 'Lowest average roll is **' + Math.round(stats.lowestAverage.value) + '** for ' + getUser(stats.lowestAverage.user, msg.channel).username;
                statsMsg += '\n\n • ';
                statsMsg += 'Highest average roll is **' + Math.round(stats.highestAverage.value) + '** for ' + getUser(stats.highestAverage.user, msg.channel).username;
                statsMsg += '\n\n • ';
                statsMsg += 'Most average average roll is **' + Math.round(stats.averageAverage.value) + '** for ' + getUser(stats.averageAverage.user, msg.channel).username             
                statsMsg += '\n\n • ';
                statsMsg += 'Most rolls recorded is **' + stats.mostRolls.value + '** for ' + getUser(stats.mostRolls.user, msg.channel).username;
                statsMsg += '\n\n • ';              
                statsMsg += '**' + stats.totalCount + '** total rolls recorded since ' + getNormalizedDateString(new Date(stats.oldest.time));
              }
            
              bot.sendMessage(msg.channel, statsMsg);                  
            });
          });

        //for each die size, getRollStats(size) => stats object
        // --- if no user found for an userid in db, attribute  'an unrecognized user'
        // var user = 
        /*
          TODO:
          * Show which die size are being tracked
          * Date of initial record ("tracked since...")
          * Number of total rolls
          * High & low rolls, with date and user
          * Top N users w/ number of rolls
          * User with highest/lowest/"averagist" average roll
          * - if total users is M < N, show top M instead
          * if [user] specified, show stats for specific user (high/low, number of rolls)
        */
      }
    },
    "msg": {
      usage: "<user> <message to leave user>",
      description: "leaves a message for a user the next time they come online",
      process: function(bot,msg,suffix) {
        var args = suffix.split(' ');
        var user = args.shift();
        var message = args.join(' ');
        if(user.startsWith('<@')){
          user = user.substr(2,user.length-3);
        }
        var target = msg.channel.server.members.get("id",user);
        if(!target){
          target = msg.channel.server.members.get("username",user);
        }
        messagebox[target.id] = {
          channel: msg.channel.id,
          content: target + ", " + msg.author + " said: " + message
        };
        updateMessagebox();
        bot.sendMessage(msg.channel,"message saved.")
      }
    },
    "twitch": {
      usage: "<stream>",
      description: "checks if the given stream is online",
      process: function(bot,msg,suffix){
        require("request")("https://api.twitch.tv/kraken/streams/"+suffix,
        function(err,res,body){
          var stream = JSON.parse(body);
          if(stream.stream){
            bot.sendMessage(msg.channel, suffix
              +" is online, playing "
              +stream.stream.game
              +"\n"+stream.stream.channel.status
              +"\n"+stream.stream.preview.large)
          }else{
            bot.sendMessage(msg.channel, suffix+" is offline")
          }
        });
      }
    },
    "xkcd": {
      usage: "[comic number]",
      description: "displays a given xkcd comic number (or the latest if nothing specified",
      process: function(bot,msg,suffix){
        var url = "http://xkcd.com/";
        if(suffix != "") url += suffix+"/";
        url += "info.0.json";
        require("request")(url,function(err,res,body){
          try{
            var comic = JSON.parse(body);
            bot.sendMessage(msg.channel,
              comic.title+"\n"+comic.img,function(){
                bot.sendMessage(msg.channel,comic.alt)
            });
          }catch(e){
            bot.sendMessage(msg.channel,
              "Couldn't fetch an XKCD for "+suffix);
          }
        });
      }
    },
      "watchtogether": {
          usage: "[video url (Youtube, Vimeo)",
          description: "Generate a watch2gether room with your video to watch with your little friends!",
          process: function(bot,msg,suffix){
              var watch2getherUrl = "https://www.watch2gether.com/go#";
              bot.sendMessage(msg.channel,
                  "watch2gether link",function(){
                      bot.sendMessage(msg.channel,watch2getherUrl + suffix)
                  })
          }
      },
      "uptime": {
        usage: "",
    description: "returns the amount of time since the bot started",
    process: function(bot,msg,suffix){
      var now = Date.now();
      var msec = now - startTime;
      console.log("Uptime is " + msec + " milliseconds");
      var days = Math.floor(msec / 1000 / 60 / 60 / 24);
      msec -= days * 1000 * 60 * 60 * 24;
      var hours = Math.floor(msec / 1000 / 60 / 60);
      msec -= hours * 1000 * 60 * 60;
      var mins = Math.floor(msec / 1000 / 60);
      msec -= mins * 1000 * 60;
      var secs = Math.floor(msec / 1000);
      var timestr = "";
      if(days > 0) {
        timestr += days + " days ";
      }
      if(hours > 0) {
        timestr += hours + " hours ";
      }
      if(mins > 0) {
        timestr += mins + " minutes ";
      }
      if(secs > 0) {
        timestr += secs + " seconds ";
      }
      bot.sendMessage(msg.channel,"Uptime: " + timestr);
    }
      }
  };
  try{
  var rssFeeds = undefined; //require("./rss.json");
  function loadFeeds(){
      for(var cmd in rssFeeds){
          commands[cmd] = {
              usage: "[count]",
              description: rssFeeds[cmd].description,
              url: rssFeeds[cmd].url,
              process: function(bot,msg,suffix){
                  var count = 1;
                  if(suffix != null && suffix != "" && !isNaN(suffix)){
                      count = suffix;
                  }
                  rssfeed(bot,msg,this.url,count,false);
              }
          };
      }
  }
  } catch(e) {
      console.log("Couldn't load rss.json. See rss.json.example if you want rss feed commands. error: " + e);
  }

  try{
    aliases = require("alias.json");
  } catch(e) {
    //No aliases defined
    aliases = {};
  }

  try{
    messagebox = require("messagebox.json");
  } catch(e) {
    //no stored messages
    messagebox = {};
  }
  function updateMessagebox(){
    require("fs").writeFile("./messagebox.json",JSON.stringify(messagebox,null,2), null);
  }

  function rssfeed(bot,msg,url,count,full){
      var FeedParser = require('feedparser');
      var feedparser = new FeedParser();
      var request = require('request');
      request(url).pipe(feedparser);
      feedparser.on('error', function(error){
          bot.sendMessage(msg.channel,"failed reading feed: " + error);
      });
      var shown = 0;
      feedparser.on('readable',function() {
          var stream = this;
          shown += 1
          if(shown > count){
              return;
          }
          var item = stream.read();
          bot.sendMessage(msg.channel,item.title + " - " + item.link, function() {
              if(full === true){
                  var text = htmlToText.fromString(item.description,{
                      wordwrap:false,
                      ignoreHref:true
                  });
                  bot.sendMessage(msg.channel,text);
              }
          });
          stream.alreadyRead = true;
      });
  }

  commandList = {};
  Object.keys(commands).forEach(cmd => {
    commandList[cmd] = commands[cmd];
  });

  var bot = new Discord.Client();

  bot.on("ready", function () {
    // loadFeeds();
    console.log("Ready to begin! Serving in " + bot.channels.length + " channels");
    require("./plugins.js").init();
  });

  bot.on("disconnected", function () {
    console.log("Disconnected from server.");
    process.exit(1); //exit node.js with an error
  });

  bot.on("message", function (msg) {
    //check if message is a command
    if(msg.author.id != bot.user.id && (msg.content[0] === '!' || msg.content.indexOf(bot.user.mention()) == 0)){
          console.log("treating " + msg.content + " from " + msg.author + " as command");
      var cmdTxt = msg.content.split(" ")[0].substring(1);
          var suffix = msg.content.substring(cmdTxt.length+2);//add one for the ! and one for the space
          if(msg.content.indexOf(bot.user.mention()) == 0){
        try {
          cmdTxt = msg.content.split(" ")[1];
          suffix = msg.content.substring(bot.user.mention().length+cmdTxt.length+2);
        } catch(e){ //no command
          bot.sendMessage(msg.channel,"Yes?");
          return;
        }
          }
      alias = aliases[cmdTxt];
      if(alias){
        console.log(cmdTxt + " is an alias, constructed command is " + alias.join(" ") + " " + suffix);
        cmdTxt = alias[0];
        suffix = alias[1] + " " + suffix;
      }
      var cmd = commands[cmdTxt];
          if(cmdTxt === "help"){
              //help is special since it iterates over the other commands
        bot.sendMessage(msg.author,"Available Commands:", function(){
          for(var cmd in commands) {
            var info = "!" + cmd;
            var usage = commands[cmd].usage;
            if(usage){
              info += " " + usage;
            }
            var description = commands[cmd].description;
            if(description){
              info += "\n\t" + description;
            }
            bot.sendMessage(msg.author,info);
          }
        });
          }
      else if(cmd) {
        //TODO: proper declarative permissions
        if(cmd.permissions && cmd.permissions.indexOf('all') !== -1 || Permissions.checkPermission(msg.author,"basic")) {
          try{
            cmd.process(bot,msg,suffix);
          } catch(e){
            if(Config.debug){
              bot.sendMessage(msg.channel, "command " + cmdTxt + " failed :(\n" + e.stack);
            }
          }
        } else {
          if(Config.respondToInvalid){
            bot.sendMessage(msg.channel, "Invalid command " + cmdTxt);
          }
        }
      }
    } else if (msg.author.id != bot.user.id && msg.content.indexOf(messagePatterns.tableFlip.flip) !== -1) {
      var responses = [
       'You seemed to have flipped your table! Let me fix that for you.\n' + messagePatterns.tableFlip.unflip,
       messagePatterns.tableFlip.sad + ' your table...'
      ];
      bot.sendMessage(msg.channel, randomElement(responses));
    } else if (msg.author.id != bot.user.id && msg.content.indexOf(messagePatterns.tableFlip.unflip) !== -1) {
      bot.sendMessage(msg.channel, 'F this table! ' + messagePatterns.tableFlip.flip);
    } else {
      //message isn't a command or is from us
          //drop our own messages to prevent feedback loops
          if(msg.author == bot.user){
              return;
          }
          
          if (msg.author != bot.user && msg.isMentioned(bot.user)) {
                  bot.sendMessage(msg.channel,msg.author + ", you called?");
          }
      }

    if (msg.author.id != bot.user.id && msg.content.toLowerCase().indexOf('beetlejuice') !== -1) {
      var numNewBeetlejuices = countOccurrences(msg.content.toLowerCase(), 'beetlejuice');
      numNewBeetlejuices = Math.min(numNewBeetlejuices, 3 - beetlejuiceCount%3);
      beetlejuiceCount = (beetlejuiceCount + numNewBeetlejuices) % 6;

      log.info('Beetlejuice count: ' + beetlejuiceCount);

      if (beetlejuiceCount === 3) {
        var avatar = avatars[suffix];
        bot.setAvatar(avatars.beetlejuice, function() {
          bot.sendMessage(msg.channel,
            randomElement(beetlejuiceMessages.beetlejuice));
        });
      } else if (beetlejuiceCount === 5) {
        bot.sendMessage(msg.channel, randomElement(beetlejuiceMessages.worried));
      } else if (beetlejuiceCount === 0) {
        var avatar = avatars[suffix];
          bot.sendMessage(msg.channel, randomElement(beetlejuiceMessages.banished), function() {
            bot.setAvatar(avatars.baggle, function() {
              bot.sendMessage(msg.channel, ':coffin: :skull: :coffin: :skull: :coffin: :skull: :coffin:', function() {
              setTimeout(function() {
                bot.sendMessage(msg.channel, randomElement(beetlejuiceMessages.done));
              }, 2000);
            });
          });
        });
      }
    } 

    if (msg.author.id != bot.user.id && globals.config.dieroll.users.approved.map(user => user.id).indexOf(msg.author.id) !== -1 
      && msg.content.toLowerCase().match(/<@\d+> rolled '\d+\s*d\s*\d+'/)) {
        var match = msg.content.toLowerCase().match(/<@(\d+)> rolled '(\d+)\s*d\s*(\d+)' for ((\d+,?)+)/);
        if (match) {
          var userId = match[1];
          var numDice = parseInt(match[2]);
          var sides = parseInt(match[3]);
          var results = match[4].split(',').map(result => parseInt(result));

          if (numDice !== results.length) {
            log.warn('Roll message had mismatched number of dice. reported # of dice: ' + sides + '; actual # of sides: ' + results.length + '; full message: ' + msg.content);
          } else {
            globals.chatData.dieRolls.handleDieRolls(results, sides, msg.channel, userId, msg.author.username, msg.content);
          }
        }
    }
  });
   

  //Log user status changes
  bot.on("presence", function(user,status,gameId) {
    //if(status === "online"){
    //console.log("presence update");
    console.log(user+" went "+status);
    //}
    try{
    if(status != 'offline'){
      if(messagebox.hasOwnProperty(user.id)){
        console.log("found message for " + user.id);
        var message = messagebox[user.id];
        var channel = bot.channels.get("id",message.channel);
        delete messagebox[user.id];
        updateMessagebox();
        bot.sendMessage(channel,message.content);
      }
    }
    }catch(e){}
  });

  function randomElement(_array) {
    return _array[Math.floor(Math.random()*_array.length)]
  }

  function countOccurrences(str, substr) {
    var occurrences = 0;
    if (str && str.length > 0 && substr && substr.length > 0 && substr.length <= str.length) {
       while (str && str.indexOf(substr) !== -1) {
          occurrences++;
          str = str.substr(str.indexOf(substr) + substr.length);
       }
    }
    return occurrences;
  }

  function getChannels(bot, nameOrId) {
    var channels = []; 

    var channel = bot.channels.get("id", nameOrId);
    if(nameOrId.startsWith('<#')){
      channel = bot.channels.get("id",nameOrId.substr(2,nameOrId.length-3));
    }
    if (channel) {
      channels.push(channel);
    }

    if(channels.length === 0){
      channels = bot.channels.getAll("name",nameOrId) || [];
    }
    return channels;
  }

  function findChannel(bot, msg, nameOrId) {
    var channels = getChannels(bot, nameOrId);
    if (channels.length === 0) {
      bot.sendMessage(msg.channel, "Couldn't find channel " + nameOrId + " to delete!");
      return;
    } else if (channels.length > 1) {
      var response = "Multiple channels match, please use id:";
      for(var i = 0; i < channels.length ;i++) {
        response += channels[i] + ": " + channels[i].id;
      }
      bot.sendMessage(msg.channel,response);
      return;            
    }
    return channels[0];
  }

  function get_gif(tags, func) {
          //limit=1 will only return 1 gif
          var params = {
              "api_key": giphy_config.api_key,
              "rating": giphy_config.rating,
              "format": "json",
              "limit": 1
          };
          var query = qs.stringify(params);

          if (tags !== null) {
              query += "&tag=" + tags.join('+')
          }

          //wouldnt see request lib if defined at the top for some reason:\
          var request = require("request");
          //console.log(query)
          request(giphy_config.url + "?" + query, function (error, response, body) {
              //console.log(arguments)
              if (error || response.statusCode !== 200) {
                  console.error("giphy: Got error: " + body);
                  console.log(error);
                  //console.log(response)
              }
              else {
                  try{
                      var responseObj = JSON.parse(body)
                      func(responseObj.data.id);
                  }
                  catch(err){
                      func(undefined);
                  }
              }
          }.bind(this));
      }
  exports.addCommand = function(commandName, commandObject){
      try {
          commands[commandName] = commandObject;
      } catch(err){
          console.log(err);
      }
  }
  exports.commandCount = function(){
      return Object.keys(commands).length;
  }
  log.ignore('Logging in with credientials: username: ' + AuthDetails.email + '; password: ' + AuthDetails.password.replace(/./g, '*'));
  bot.login(AuthDetails.email, AuthDetails.password);
});

function getUser(userId, channel) {
  log.debug('finding user ' + userId + ' for server ' + channel.server);
  log.ignore(' in members ' + (channel.server ? utils.node.inspect(channel.server.members) : undefined));
  var user = channel.server ? channel.server.members.get('id', userId) : undefined;
  return user ? user : { username: '**unknown user**'};
}

function loadConfig(configName) {
  var configPath = './config/';
  var overridePath = configPath + 'overrides/';
  var _config = configPath + configName + '.json';
  var _override = overridePath + configName + '.json';

  if (globals.config.hasOwnProperty(configName)) {
    return Promise.resolve(config[configName]);
  }

  return utils.readFile(_override)
    .then(undefined, () => utils.readFile(_config))
    .then(data => {  globals.config[configName] = data; }, function(e) {});
}


// function loadConfig(configName) {
//   var configPath = './config/';
//   var overridePath = configPath + 'overrides/';
//   var _config = configPath + configName + '.json';
//   var _override = overridePath + configName + '.json';

//   console.log('Attempting to load config override ' + configName + ' from ' + _override);

//   if (globals.config.hasOwnProperty(configName)) {
//     console.log('Config already loaded:');
//     console.log(config[configName]);
//     return Promise.resolve(config[configName]);
//   }

//   return utils.readFile(_override)
//     .then(
//       data => { console.log('Loaded ' + __override); return data; }, () => {
//         console.log('Override not found. Attempting to load default config: ' + _config);
//         return utils.readFile(_config);
//      })
//     .then(data => { 
//       console.log('Loaded :');
//       console.log(data); 
//       globals.config[configName] = data;
//     }, function(e) {});
// }

function request() {
  var args = Array.prototype.slice.call(arguments);
  return new Promise(function(resolve, reject) {
    args.push(function(error, response, body) {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });

    return Request.apply(this, args);
  });  
}

