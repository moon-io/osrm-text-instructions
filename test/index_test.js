/* eslint max-lines: "off" */
var path = require('path');
var fs = require('fs');
var tape = require('tape');

var compiler = require('../index');
var languages = require('../languages');
var instructions = languages.instructions;

tape.test('v5 tokenize', function(assert) {
    var v5Compiler = compiler('v5');

    var tokenString = 'Can {first} {second}';

    var hasBoth = v5Compiler.tokenize('en', tokenString, {
        first: 'osrm',
        second: 'do routing'
    });
    assert.equal(hasBoth, 'Can osrm do routing', 'does find and replace');

    var hasFirst = v5Compiler.tokenize('en', tokenString, {
        first: 'osrm',
        second: ''
    });
    assert.equal(hasFirst, 'Can osrm ', 'does find and replace and does not drop trailing spaces');

    var hasSecond = v5Compiler.tokenize('en', tokenString, {
        second: 'swim',
        first: ''
    });
    assert.equal(hasSecond, 'Can swim', 'does find and replace and drops internal extra spaces');

    var missingSecond = v5Compiler.tokenize('en', tokenString, {
        first: 'osrm'
    });
    assert.equal(missingSecond, 'Can osrm {second}', 'does not replace tokens which are not provided');

    var formatsTokens = v5Compiler.tokenize('en', 'Take me {destination}, {way_name}', {
        destination: 'home',
        'way_name': 'Country Road'
    }, {
        formatToken: function (token, value) {
            if (token === 'destination') {
                return '<prosody rate="slow">' + value + '</prosody>';
            }
            if (token === 'name' || token === 'way_name' || token === 'rotary_name') {
                return value.replace('Road', '<prosody rate="slow">Road</prosody>');
            }

            return value;
        }
    });
    assert.equal(formatsTokens, 'Take me <prosody rate="slow">home</prosody>, Country <prosody rate="slow">Road</prosody>',
                 'Formats tokens');

    var capitalizesTokens = v5Compiler.tokenize('en', '{modifier} turns are prohibited here', {
        modifier: 'left'
    }, {
        formatToken: function (token, value) {
            if (token === 'modifier') {
                return '<strong>' + value + '</strong>';
            }

            return value;
        }
    });
    assert.equal(capitalizesTokens, '<strong>Left</strong> turns are prohibited here',
                 'Capitalizes tokens before formatting');

    var formatsGrammaticalTokens = v5Compiler.tokenize('ru', 'Плавно поверните налево на {way_name:accusative}', {
        'way_name': 'Бармалеева улица'
    }, {
        formatToken: function (token, value) {
            return token === 'way_name' ? value.toLocaleUpperCase('ru') : value;
        }
    });
    assert.equal(formatsGrammaticalTokens, 'Плавно поверните налево на БАРМАЛЕЕВУ УЛИЦУ',
                 'Formats tokens after grammaticalization but before insertion');

    assert.end();
});

tape.test('v5 directionFromDegree', function(assert) {
    var v5Compiler = compiler('v5');

    assert.equal(
        v5Compiler.directionFromDegree('en', undefined), // eslint-disable-line no-undefined
        '',
        'empty string for undefined'
    );

    [
        [ 0,   'north' ],
        [ 1,   'north' ],
        [ 20,  'north' ],
        [ 21,  'northeast' ],
        [ 69,  'northeast' ],
        [ 70,  'east' ],
        [ 110, 'east' ],
        [ 111, 'southeast' ],
        [ 159, 'southeast' ],
        [ 160, 'south' ],
        [ 200, 'south' ],
        [ 201, 'southwest' ],
        [ 249, 'southwest' ],
        [ 250, 'west' ],
        [ 290, 'west' ],
        [ 291, 'northwest' ],
        [ 339, 'northwest' ],
        [ 340, 'north' ],
        [ 360, 'north' ]
    ].forEach((d) => {
        assert.equal(
            v5Compiler.directionFromDegree('en', d[0]),
            d[1],
            `${d[0]} degrees is ${d[1]}`
        );
    });

    assert.throws(
        () => { v5Compiler.directionFromDegree('en', 361); },
        'throws on out of bounds degree'
    );

    assert.end();
});

tape.test('v5 wayName', function(assert) {
    var v5Compiler = compiler('v5');

    function makeStep(ref, name) {
        return {
            ref: ref,
            name: name
        };
    }

    [
        [makeStep('', ''), ''],
        [makeStep('ref', 'name'), 'Name (ref)'],
        [makeStep('ref', 'name (ref)'), 'Name (ref)'],
        [makeStep('ref; other', 'name (ref; other)'), 'Name (ref)'],
        [makeStep('ref1; ref2', 'name'), 'Name (ref1)'],
        [makeStep('ref1; ref2', 'name (ref1; ref2)'), 'Name (ref1)']
    ].forEach((c, i) => {
        assert.equal(v5Compiler.getWayName('en', c[0]), c[1], `correct way name for non motorway test ${i}`);
    });

    [
        [makeStep('', ''), ''],
        [makeStep('ref', 'name'), 'name'],
        [makeStep('ref1', 'name'), 'ref1'],
        [makeStep('ref', 'name (ref)'), 'name'],
        [makeStep('ref1', 'name (ref1)'), 'ref1'],
        [makeStep('ref1; ref2', 'name'), 'ref1'],
        [makeStep('ref1; ref2', 'name (ref1; ref2)'), 'ref1']
    ].forEach((c, i) => {
        assert.equal(v5Compiler.getWayName('en', c[0], {classes: ['motorway']}), c[1], `correct way name for motorway test ${i}`);
    });

    assert.throws(
        () => { v5Compiler.getWayName(); },
        'throws when no step is passed'
    );

    assert.throws(
        () => { v5Compiler.getWayName({}, 1); },
        'throws when classes is invalid'
    );

    assert.end();
});

tape.test('v5 laneDiagram', function(assert) {
    var v5Compiler = compiler('v5');

    function makeStep(config) {
        return {
            intersections: [
                {
                    lanes: config.map((v) => ({'valid': v}))
                }
            ]
        };
    }

    [
        [ [ true, true, true ], 'o' ],
        [ [ true, true, false], 'ox' ],
        [ [ true, true, false, false], 'ox' ],
        [ [ true, false, true], 'oxo' ],
        [ [ false, true, true, false], 'xox' ],
        [ [ false, true, false, true, false], 'xoxox' ],
        [ [ false, false, false], 'x' ]
    ].forEach((c) => {
        assert.equal(v5Compiler.laneConfig(makeStep(c[0])), c[1], `correct Diagram ${c[1]}`);
    });

    assert.throws(
        () => { v5Compiler.laneConfig({}); },
        'throws on non-existing intersections'
    );

    assert.throws(
        () => {
            v5Compiler.laneConfig({
                intersections: [
                    {}
                ]
            });
        },
        'throws on non-existing lanes'
    );

    assert.end();
});

tape.test('v5 compile', function(t) {
    t.test('throws an error if no language code provided', function(assert) {
        var v5Compiler = compiler('v5');

        assert.throws(function() {
            v5Compiler.compile();
        }, /No language code provided/
    );

        assert.end();
    });

    t.test('throws an error if a non supported language code is provided', function(assert) {
        var v5Compiler = compiler('v5');

        assert.throws(function() {
            v5Compiler.compile('foo');
        }, /language code foo not loaded/);

        assert.end();
    });

    t.test('en-US fallback to en', function(assert) {
        var v5Compiler = compiler('v5');
        var language = v5Compiler.getBestMatchingLanguage('en-us');

        assert.equal(v5Compiler.compile(language, {
            maneuver: {
                type: 'turn',
                modifier: 'left'
            },
            name: 'Way Name'
        }), 'Turn left onto Way Name');

        assert.end();
    });

    t.test('zh-CN fallback to zh-Hans', function(assert) {
        var v5Compiler = compiler('v5');
        var language = v5Compiler.getBestMatchingLanguage('zh-CN');

        assert.equal(v5Compiler.compile(language, {
            maneuver: {
                type: 'turn',
                modifier: 'left'
            },
            name: 'Way Name'
        }), '左转，上Way Name');

        assert.end();
    });

    t.test('zh-Hant fallback to zh-Hanz', function(assert) {
        var v5Compiler = compiler('v5');
        var language = v5Compiler.getBestMatchingLanguage('zh-Hant');

        assert.equal(v5Compiler.compile(language, {
            maneuver: {
                type: 'turn',
                modifier: 'left'
            },
            name: 'Way Name'
        }), '左转，上Way Name');

        assert.end();
    });

    t.test('zh-Hant-TW fallback to zh-Hant', function(assert) {
        var v5Compiler = compiler('v5');
        var language = v5Compiler.getBestMatchingLanguage('zh-Hant-TW');

        assert.equal(v5Compiler.compile(language, {
            maneuver: {
                type: 'turn',
                modifier: 'left'
            },
            name: 'Way Name'
        }), '左转，上Way Name');

        assert.end();
    });

    t.test('es-MX fallback to es', function(assert) {
        var v5Compiler = compiler('v5');
        var language = v5Compiler.getBestMatchingLanguage('es-MX');

        assert.equal(v5Compiler.compile(language, {
            maneuver: {
                type: 'turn',
                modifier: 'straight'
            },
            name: 'Way Name'
        }), 'Ve recto en Way Name');

        assert.end();
    });

    t.test('getBestMatchingLanguage', function(t) {
        t.equal(compiler('v5').getBestMatchingLanguage('foo'), 'en');
        t.equal(compiler('v5').getBestMatchingLanguage('en-US'), 'en');
        t.equal(compiler('v5').getBestMatchingLanguage('zh-CN'), 'zh-Hans');
        t.equal(compiler('v5').getBestMatchingLanguage('zh-Hant'), 'zh-Hans');
        t.equal(compiler('v5').getBestMatchingLanguage('zh-Hant-TW'), 'zh-Hans');
        t.equal(compiler('v5').getBestMatchingLanguage('zh'), 'zh-Hans');
        t.equal(compiler('v5').getBestMatchingLanguage('es-MX'), 'es');
        t.equal(compiler('v5').getBestMatchingLanguage('es-ES'), 'es-ES');
        t.equal(compiler('v5').getBestMatchingLanguage('pt-PT'), 'pt-BR');
        t.equal(compiler('v5').getBestMatchingLanguage('pt'), 'pt-BR');
        t.equal(compiler('v5').getBestMatchingLanguage('pt-pt'), 'pt-BR');
        t.end();
    });

    t.test('respects options.instructionStringHook', function(assert) {
        var v5Compiler = compiler('v5', {
            hooks: {
                tokenizedInstruction: function(instruction) {
                    return instruction.replace('{way_name}', '<blink>{way_name}</blink>');
                }
            }
        });

        assert.equal(v5Compiler.compile('en', {
            maneuver: {
                type: 'turn',
                modifier: 'left'
            },
            name: 'Way Name'
        }), 'Turn left onto <blink>Way Name</blink>');
        assert.end();
    });

    t.test('fixtures match generated instructions', function(assert) {
        // pre-load instructions
        var version = 'v5';
        var instructionsPerLanguage = compiler(version);

        var basePath = path.join(__dirname, 'fixtures', version);

        fs.readdirSync(basePath).forEach(function(type) {
            if (type.match(/^\./)) return; // ignore temporary files

            if (type === 'phrase') {
                fs.readdirSync(path.join(basePath, type)).forEach(function(file) {
                    if (!file.match(/\.json$/)) return;

                    var p = path.join(basePath, type, file);
                    var fixture = JSON.parse(fs.readFileSync(p));
                    var phrase = file.replace(/\..*/, '').replace(/_/g, ' ');
                    var options;
                    if (fixture.options) {
                        options = {
                            'instruction_one': fixture.options.instruction_one,
                            'instruction_two': fixture.options.instruction_two,
                            distance: fixture.options.distance
                        };
                    }

                    Object.keys(fixture.phrases).forEach((l) => {
                        assert.equal(
                            instructionsPerLanguage.tokenize(l, instructions[l][version].phrase[phrase], options),
                            fixture.phrases[l],
                            `${type}/${file}/${l}`
                        );
                    });
                });
            } else {
                fs.readdirSync(path.join(basePath, type)).forEach(function(file) {
                    if (!file.match(/\.json$/)) return;

                    var p = path.join(basePath, type, file);
                    var fixture = JSON.parse(fs.readFileSync(p));
                    var options;
                    if (fixture.options) {
                        options = {};
                        options.legIndex = fixture.options.legIndex;
                        options.legCount = fixture.options.legCount;
                        options.classes = fixture.options.classes;
                    }

                    Object.keys(fixture.instructions).forEach((l) => {
                        assert.equal(
                            instructionsPerLanguage.compile(l, fixture.step, options),
                            fixture.instructions[l],
                            `${type}/${file}/${l}`
                        );
                    });
                });
            }
        });

        assert.end();
    });
});
