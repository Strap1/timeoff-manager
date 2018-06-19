
"use strict";

const
  express  = require('express'),
  router   = express.Router(),
  _        = require('underscore'),
  moment   = require('moment'),
  Promise  = require('bluebird'),
  ical     = require('ical-generator'),
  TeamView = require('../model/team_view');

router.get('/:token/ical.ics', function(req, res){

  var cal = ical({
      domain : 'timeoff.management',
    }),
    token = req.param('token'),
    model = req.app.get('db_model'),
    user;

  Promise
    .resolve()
    .then(function(){
      return model.UserFeed.find({
        where : {feed_token : token},
        include : [
          {
            model : model.User,
            as : 'user',
            include : [{
              model : model.Company,
              as : 'company',
            }]
          }
        ]
      });
    })
    .then(function(feed){

      if ( ! feed ) {
        throw new Error("Unknown token provided");
      }

      user = feed.user;

      if (feed.is_calendar()){
        cal.name(user.full_name() + ' calendar');

        return user
          .promise_calendar({
            year           : user.calendar.company.get_today(),
            show_full_year : true,
          })
          .then(function(calendar){
            let days = _.flatten( calendar.map( cal => cal.as_for_team_view() ));

            days.forEach(day => day.user = user);

            return Promise.resolve(days);
          });
      } else {

        cal.name(user.full_name() + ' team');

        return Promise
          .resolve([0,1,2,3,4,5,6].map(
            delta => user.company.get_today().clone().add(delta, 'months').startOf('month'))
          )
          .map(month => {

            const team_view = new TeamView({
              user      : user,
              base_date : month,
            });

            return team_view.promise_team_view_details()
              .then(details => {
                let days = [];

                details.users_and_leaves.forEach(rec => {
                  rec.days.forEach(day => day.user = rec.user);
                  days = days.concat( rec.days );
                });

                return Promise.resolve(days);
              });
          })
          .then(arrayOfDays => Promise.resolve( _.flatten(arrayOfDays) ));
      }
    })

    .then(function(days){

      days.forEach(function(day){

        // We care only about days when employee is on leave
        if (!(day.is_leave_morning || day.is_leave_afternoon)) {
          return;
        }

        var start = moment.utc(day.moment),
            end = moment.utc(day.moment);

        if (day.is_leave_morning && day.is_leave_afternoon) {
          start.hour(9).minute(0);
          end.hour(17).minute(0);
        } else if (!day.is_leave_morning && day.is_leave_afternoon) {
          start.hour(13).minute(0);
          end.hour(17).minute(0);
        } else if (day.is_leave_morning && !day.is_leave_afternoon) {
          start.hour(9).minute(0);
          end.hour(13).minute(0);
        }

        cal.createEvent({
          start       : start.toDate(),
          end         : end.toDate(),
          summary     : day.user.full_name() + ' is out of office',
//          description : 'It works ;)',
        });
      });

      res.send( cal.toString() );
    })
    .catch(function(){
      // TODO VPP set 404 status
      res.send('N/A');
    });

});


module.exports = router;
