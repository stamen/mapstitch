# mapstitch

Stitches map tiles together.

## Installation

```bash
npm install mapstitch
```

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
