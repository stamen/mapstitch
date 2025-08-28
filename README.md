# mapstitch

Stitches map tiles together.

UPDATE: if you found this repository, you probably would rather use our slightly more recent tool here: https://github.com/stamen/the-ultimate-tile-stitcher

## Installation

```bash
npm install mapstitch
```

## Running

```bash
npm start
```

Then visit `http://localhost:8080/mapimg?w=1500&h=1500&extent=37.955:-122.737:37.449:-122.011&p=toner` to see a stitched map.

 * The `w` and `h` parameters are the width and height of the desired image in pixels. 
 * the `extent` parameter is the extent of the mapped area in degrees. They should be in this order: max latitude : min longitude : min latitude : max longitude. (another way to phrase this: upper left y, upper left x, lower right y, lower right x)

## Custom Validation

When initializing `mapstitch`, provide a custom `validate` function. The stitch
object that's returned will be bound as `this`, so you can extend as well as
skip the built-in validation:

```javascript
var stitch = require("mapstitch")({
  validate: function(err, res, callback) {
    return this.validate(err, res, function(err) {
      if (err) {
        return callback(err);
      }

      // arbitrarily fail 10% of the time
      if (Math.random() * 10 <= 1) {
        return callback(new Error("Randomized error value"));
      }

      return callback();
    });
  }
});
```

## License

Copyright (c) 2013 Stamen

Published under the MIT License.
