/**
 * Copyright 2019 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const argv = require('minimist')(process.argv.slice(2));
const log = require('fancy-log');
const requestPromise = require('request-promise');
const {cyan, green, yellow} = require('ansi-colors');
const {gitCommitHash} = require('../git');
const {isTravisPullRequestBuild} = require('../travis');

const reportBaseUrl = 'https://amp-test-status-bot.appspot.com/v0/tests';

const IS_GULP_INTEGRATION = !!argv.integration;
const IS_GULP_UNIT = argv._[0] === 'unit';
const IS_GULP_E2E = argv._[0] === 'e2e';

const IS_LOCAL_CHANGES = !!argv.local_changes;
const IS_SAUCELABS = !!(argv.saucelabs || argv.saucelabs_lite);
const IS_SINGLE_PASS = !!argv.single_pass;

const TEST_TYPE_SUBTYPES = new Map([
  ['integration', ['local', 'single-pass', 'saucelabs']],
  ['unit', ['local', 'local_changes', 'saucelabs']],
  ['e2e', ['local']],
]);
const TEST_TYPE_BUILD_TARGETS = new Map([
  ['integration', ['RUNTIME', 'FLAG_CONFIG', 'INTEGRATION_TEST']],
  ['unit', ['RUNTIME', 'UNIT_TEST']],
  ['e2e', ['RUNTIME', 'FLAG_CONFIG', 'E2E_TEST']],
]);

function inferTestType() {
  if (IS_GULP_E2E) {
    return 'e2e/local';
  }

  let type;
  if (IS_GULP_UNIT) {
    type = 'unit';
  } else if (IS_GULP_INTEGRATION) {
    type = 'integration';
  } else {
    return null;
  }

  if (IS_LOCAL_CHANGES) {
    return `${type}/local_changes`;
  }

  if (IS_SAUCELABS) {
    return `${type}/saucelabs`;
  }

  if (IS_SINGLE_PASS) {
    return `${type}/single-pass`;
  }

  return `${type}/local`;
}

function postReport(type, action) {
  if (type !== null && isTravisPullRequestBuild()) {
    const commitHash = gitCommitHash();
    const postUrl = `${reportBaseUrl}/${commitHash}/${type}/${action}`;
    return requestPromise
      .post(postUrl)
      .then(body => {
        log(
          green('INFO:'),
          'reported',
          cyan(`${type}/${action}`),
          'to the test-status GitHub App'
        );
        if (body.length > 0) {
          log(
            green('INFO:'),
            'response from test-status was',
            cyan(body.substr(0, 100))
          );
        }
      })
      .catch(error => {
        log(
          yellow('WARNING:'),
          'failed to report',
          cyan(`${type}/${action}`),
          'to the test-status GitHub App:\n',
          error.message.substr(0, 100)
        );
        return;
      });
  }
  return Promise.resolve();
}

function reportTestErrored() {
  return postReport(inferTestType(), 'report/errored');
}

function reportTestFinished(success, failed) {
  return postReport(inferTestType(), `report/${success}/${failed}`);
}

function reportTestSkipped() {
  return postReport(inferTestType(), 'skipped');
}

function reportTestStarted() {
  return postReport(inferTestType(), 'started');
}

async function reportAllExpectedTests(buildTargets) {
  for (const [type, subTypes] of TEST_TYPE_SUBTYPES) {
    const testTypeBuildTargets = TEST_TYPE_BUILD_TARGETS.get(type);
    const action = testTypeBuildTargets.some(target => buildTargets.has(target))
      ? 'queued'
      : 'skipped';
    for (const subType of subTypes) {
      await postReport(`${type}/${subType}`, action);
    }
  }
}

/**
 * Callback to the Karma.Server on('run_complete') event for simple test types.
 *
 * @param {!any} browsers
 * @param {!Karma.TestResults} results
 */
function reportTestRunComplete(browsers, results) {
  if (results.error) {
    reportTestErrored();
  } else {
    reportTestFinished(results.success, results.failed);
  }
}

module.exports = {
  reportAllExpectedTests,
  reportTestErrored,
  reportTestFinished,
  reportTestRunComplete,
  reportTestSkipped,
  reportTestStarted,
};
