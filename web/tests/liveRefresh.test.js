import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { liveRevision, useLiveRefresh } from '../src/composables/useLiveRefresh.js';

const RefreshProbe = defineComponent({
  props: { load: { type: Function, required: true } },
  setup(props) { useLiveRefresh(props.load); return () => null; }
});

describe('Live data refresh', () => {
  it('coalesces updates while loading and finishes with a fresh read', async () => {
    let finish;
    const load = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const wrapper = mount(RefreshProbe, { props: { load } });
    expect(load).toHaveBeenCalledOnce();
    liveRevision.value += 1;
    await nextTick();
    liveRevision.value += 1;
    await nextTick();
    expect(load).toHaveBeenCalledOnce();
    finish();
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    liveRevision.value += 1;
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not start a queued refresh after the view unmounts', async () => {
    let finish;
    const load = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const wrapper = mount(RefreshProbe, { props: { load } });
    liveRevision.value += 1;
    await nextTick();
    wrapper.unmount();
    finish();
    await flushPromises();
    expect(load).toHaveBeenCalledOnce();
  });
});
