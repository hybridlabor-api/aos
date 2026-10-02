'use strict';

/**
 * Plan Canvas artifact SDK: the script injected into the reviewed artifact.
 * The layer itself lives in ./annotate-client (shared with /annotate.js).
 * Source: affaan-m/ECC (MIT), see THIRD_PARTY_NOTICES.md
 */

const { annotateClientJs } = require('./annotate-client');

function artifactSdkJs() {
  return annotateClientJs({ transport: 'postMessage' });
}

module.exports = { artifactSdkJs };
