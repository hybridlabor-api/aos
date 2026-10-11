'use strict';
// While AOS_NONINTERACTIVE=1 (set by run.step) a prompt returns its default instead of waiting for a TTY.
const active = () => process.env.AOS_NONINTERACTIVE === '1';
const wrap = (fn, answer) => (cfg = {}, ...rest) => (active() ? Promise.resolve(answer(cfg)) : fn(cfg, ...rest));

module.exports = (clack) => ({
    text: wrap(clack.text, (c) => (c.initialValue !== undefined ? c.initialValue : c.defaultValue !== undefined ? c.defaultValue : '')),
    password: wrap(clack.password, () => ''),
    select: wrap(clack.select, (c) => (c.initialValue !== undefined ? c.initialValue : c.options && c.options[0] && c.options[0].value)),
    multiselect: wrap(clack.multiselect, (c) => c.initialValues || []),
    confirm: wrap(clack.confirm, (c) => (c.initialValue !== undefined ? c.initialValue : true)),
    active,
});
