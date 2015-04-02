/*
 * grunt-extract-styles
 *
 * Copyright (c) 2015 Felix
 * Licensed under the MIT license.
 */

'use strict';
var postcss = require('postcss');
var path = require('path');

function getMatches(fileContent, options, sourceDir, destDir) {
  var destFilePaths = [];
  sourceDir = (sourceDir !== '') ? path.normalize(sourceDir) : '';

  var matches;
  while (matches = options.linkPattern.exec(fileContent)) {
    var hrefLink = matches[1];
    var sourceFilePath = path.normalize(hrefLink).split(options.linkIdentifier)[0];
    var pos = sourceFilePath.lastIndexOf('.');
    var remainFilePath = sourceFilePath.substring(0, pos) + options.remainSuffix + sourceFilePath.substring(pos);
    var destFile = matches[2];
    var extractedFilePath = sourceFilePath;
    extractedFilePath = (extractedFilePath.indexOf('/') > -1) ? path.dirname(extractedFilePath) + '/' : '';
    extractedFilePath += destFile;

    var originalLink = matches[0];
    var replaceOrgLink = originalLink.replace(hrefLink, remainFilePath);
    var replaceExtractedLink = originalLink.replace(hrefLink, extractedFilePath + options.extractedSuffix);

    destFilePaths.push({
      originalLink: originalLink,
      replaceLinks: [
        replaceOrgLink,
        replaceExtractedLink
      ],
      sourceFile: sourceDir + sourceFilePath,
      remainFile: remainFilePath,
      destFiles: {
        source: destDir + sourceFilePath,
        remain: destDir + remainFilePath,
        extracted: destDir + extractedFilePath.split('?')[0]
      }
    });
  }

  return destFilePaths;
}

function handleDeclaration(decl, newRule, options) {
  if (options.pattern.test(decl.toString())) {
    var newDecl = decl.clone();
    newDecl.before = decl.before;
    newRule.append(newDecl);

    if (options.remove) {
      decl.removeSelf();
    }
  }
}

function parseCss(css, options, newCSS) {
  if (options.pattern) {
    var atRules = {};

    css.eachRule(function (rule) {
      var newRule = rule.clone();

      newRule.eachDecl(function (decl) {
        decl.removeSelf();
      });

      if (rule.parent.type === 'root') {
        rule.eachDecl(function (decl) {
          handleDeclaration(decl, newRule, options);
        });

        if (newRule.decls.length) {
          newCSS.append(newRule);
        }

      }
      else if (rule.parent.name === 'media') {
        var newAtRule = rule.parent.clone();
        newAtRule.eachRule(function (childRule) {
          childRule.removeSelf();
        });

        var atRuleKey = newAtRule.params + '';
        if (!atRules.hasOwnProperty(atRuleKey)) {
          atRules[atRuleKey] = newAtRule;
        }
        else {
          newAtRule = atRules[atRuleKey];
        }

        rule.eachDecl(function (decl) {
          handleDeclaration(decl, newRule, options);
        });

        if (newRule.decls.length) {
          newAtRule.append(newRule);
        }
      }

      if (rule.decls.length === 0) {
        rule.removeSelf();
      }

      if (rule.parent.rules.length === 0) {
        rule.parent.removeSelf();
      }
    });

    for (var key in atRules) {
      if (atRules.hasOwnProperty(key)) {
        newCSS.append(atRules[key]);
      }
    }
  }
}

function extractStyles(sourceFile, destFiles, options, grunt) {
  var newCSS = postcss.root();

  // Our postCSS processor
  var processor = postcss(function (css) {
    parseCss(css, options, newCSS);
  });

  // Read file source.
  var css = grunt.file.read(sourceFile),
    processOptions = {},
    output;

  processOptions.from = sourceFile;
  processOptions.to = destFiles.extracted;

  if (typeof options.preProcess === 'function') {
    css = options.preProcess(css);
  }

  // Run the postprocessor
  output = processor.process(css, processOptions);

  if (typeof options.postProcess === 'function') {
    newCSS = options.postProcess(newCSS.toString());
    output.css = options.postProcess(output.css);
  }

  // Write the newly split file.
  grunt.file.write(destFiles.extracted, newCSS);
  grunt.log.write('File "' + destFiles.extracted + '" was created. - ');
  grunt.log.ok();

  // Write the destination file
  grunt.file.write(destFiles.remain, output.css);
  grunt.log.write('File "' + destFiles.remain + '" was created. - ');
  grunt.log.ok();
}

function concatFiles(file, concatFilePath, grunt) {
  var config = grunt.config(['concat', 'generated']);

  var files = grunt.task.normalizeMultiTaskFiles(config)
    // Only work on the original src/dest, since files.src is a [GETTER]
    .map(function (files) {
      return files.orig;
    }).filter(function (fileItem) {
      return fileItem.dest === concatFilePath;
    });

  var isFullBlock = true;
  files.forEach(function (files) {
    isFullBlock = isFullBlock && files.src.length > 0;

    files.src.push(file.destFiles.remain);
  });

  // Change link src to the usemin dest
  var concatFile = path.basename(concatFilePath);
  var remainFileName = path.basename(file.remainFile);
  file.replaceLinks[0] = file.replaceLinks[0].replace(remainFileName, concatFile);

  // Append css remain file to src
  if (isFullBlock) {
    file.replaceLinks.shift(); // Remove the first link
  }

  grunt.config(['concat', 'generated'], config); //save back the modified config

  grunt.log.writeln('Added "' + file.destFiles.remain.cyan + '" to "<!-- build:css({.tmp,app}) ' + concatFilePath.yellow + ' -->" Usemin css block.');
}

function concatUseminFiles(ext, file, grunt) {
  var config = grunt.config(['cssmin', 'generated']);

  if (!config) {
    return false;
  }

  // Find cssmin destination(s) matching ext
  var matches = grunt.task.normalizeMultiTaskFiles(config)
    .map(function (files) {
      return files.orig;
    })
    .filter(function (files) {
      return ext === files.dest.substr(-ext.length);
    });

  // *Something* should've matched
  if (!matches.length) {
    grunt.log.warn('Could not find usemin.generated path matching: ' + ext.red);

    return false;
  }

  var match = matches.shift();

  var concatFilePath = match.src.pop();

  // Finally, modify concat target sourced by matching uglify target
  concatFiles(file, concatFilePath, grunt);
}

function handleHTML(fileContent, options, match, grunt) {

  if (options.usemin) {
    concatUseminFiles('.css', match, grunt);
  }

  fileContent = fileContent.replace(match.originalLink, match.replaceLinks.join('\n\t'));

  return fileContent;
}

module.exports = function (grunt) {
  grunt.registerMultiTask('extractStyles', 'Extract styles from css based on decelerations matching.', function () {
    // Merge task-specific and/or target-specific options with these defaults.
    var options = this.options({
      pattern: null, // Pattern to match css declaration
      remove: true, // Should we strip the matched rules from the src style sheet?
      preProcess: null,
      postProcess: null,
      remainSuffix: '.remain', // remaining filename suffix
      extractedSuffix: '', // suffix for the extracted file link
      linkIdentifier: '?__extractStyles', // The identifier of link src
      usemin: false // if true, the remaining link will be added to the last Usemin css block
    });

    if (!options.pattern) {
      grunt.fail.fatal('Declaration pattern not found, add Regex pattern in your extractStyles task options.');
      return;
    }

    options.linkPattern = new RegExp('<link.*href="(.*' + options.linkIdentifier + '=([^"]+))".*>', 'g');

    // Iterate over all specified file groups.
    this.files.forEach(function (file) {
      file.src.forEach(function (filepath) {
        grunt.log.writeln('Processing ' + filepath + '...');

        var destDir = file.orig.dest;
        var baseDir = (file.orig.expand) ? file.orig.cwd : '';
        var htmlFileContent = grunt.file.read(filepath);
        var matches = getMatches(htmlFileContent, options, baseDir, destDir);

        matches.forEach(function (match) {
            if (!grunt.file.exists(match.sourceFile)) {
              grunt.fail.warn('Source file "' + match.sourceFile + '" not found.');
            } else {
              extractStyles(match.sourceFile, match.destFiles, options, grunt);

              htmlFileContent = handleHTML(htmlFileContent, options, match, grunt);

              if (file.orig.expand) {
                filepath = filepath.replace(baseDir, '');
              }

              grunt.file.write(destDir + filepath, htmlFileContent);

              grunt.log.write('Extracted styles from ' + match.sourceFile + '. - ');
              grunt.log.ok();
            }
          }
        );
      });
    });
  });
};
