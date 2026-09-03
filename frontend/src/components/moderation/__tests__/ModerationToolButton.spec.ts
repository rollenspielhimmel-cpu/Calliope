import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { Eye } from '@lucide/vue'
import ModerationToolButton from '@/components/moderation/ModerationToolButton.vue'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * The word an icon-only control carries. Mounted for real rather than shallow, because the
 * behaviour under test *is* the tooltip: that hovering says what the button does, and that moving
 * away takes it back again.
 *
 * `delayDuration: 0` so the assertion is about hovering rather than about waiting.
 */
function toolButton(props: { label: string; active?: boolean; disabled?: boolean }) {
  return mount(
    defineComponent({
      setup: () => () =>
        h(TooltipProvider, { delayDuration: 0, disableHoverableContent: true }, () => [
          h(ModerationToolButton, { icon: Eye, ...props }),
        ]),
    }),
    // Portalled content lands outside the wrapper, so the document is what gets read.
    { attachTo: document.body },
  )
}

/** Whatever reka-ui put in the portal, which is where the content is rendered. */
function tooltipText(): string {
  return document.body.textContent ?? ''
}

/**
 * The button's own `Tooltip` carries the 200ms delay, which overrides whatever the provider says,
 * so hovering has to be waited out rather than flushed.
 */
const HOVER_DELAY = 200

async function settle(milliseconds = 0) {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
  await nextTick()
}

describe('ModerationToolButton', () => {
  it('says nothing until the pointer arrives', async () => {
    const wrapper = toolButton({ label: 'Auf die Beobachtungsliste' })
    await settle()

    expect(tooltipText()).not.toContain('Auf die Beobachtungsliste')

    wrapper.unmount()
  })

  it('shows the label on hover and takes it back when the pointer leaves', async () => {
    const wrapper = toolButton({ label: 'Auf die Beobachtungsliste' })
    const button = wrapper.get('button')

    // `pointermove`, not `pointerenter`: that is the event reka-ui's trigger actually listens on,
    // and it ignores a `touch` pointer, so the type has to say this is a mouse.
    await button.trigger('pointermove', { pointerType: 'mouse' })
    await settle(HOVER_DELAY + 50)

    expect(tooltipText()).toContain('Auf die Beobachtungsliste')

    await button.trigger('pointerleave', { pointerType: 'mouse' })
    await settle(HOVER_DELAY + 50)

    expect(tooltipText()).not.toContain('Auf die Beobachtungsliste')

    wrapper.unmount()
  })

  it('names itself for a screen reader as well, so it is never icon-only', () => {
    const wrapper = toolButton({ label: 'IP-Adressen' })

    // The tooltip is a pointer affordance; the accessible name has to be there without one.
    expect(wrapper.get('button').attributes('aria-label')).toBe('IP-Adressen')
    // The icon repeats the label, so it is hidden rather than read twice.
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')

    wrapper.unmount()
  })

  it('is drawn differently when active, and says so as well as showing it', () => {
    const off = toolButton({ label: 'Auf die Beobachtungsliste' })
    const offButton = off.get('button')

    expect(offButton.attributes('aria-pressed')).toBe('false')
    expect(offButton.classes()).not.toContain('bg-paper-3')
    off.unmount()

    const on = toolButton({ label: 'Von der Beobachtungsliste nehmen', active: true })
    const onButton = on.get('button')

    expect(onButton.attributes('aria-pressed')).toBe('true')
    // The visible half of it: a filled ground, so the state is not carried by the label alone.
    expect(onButton.classes()).toContain('bg-paper-3')
    on.unmount()
  })

  it('emits nothing while disabled', async () => {
    const wrapper = toolButton({ label: 'IP-Adressen', disabled: true })

    await wrapper.get('button').trigger('click')

    expect(wrapper.findComponent(ModerationToolButton).emitted('click')).toBeUndefined()

    wrapper.unmount()
  })
})
