<script setup lang="ts"></script>

<template>
  <!-- The shared card elevation, like every other card since. It sits on the recessed rail rather
       than on the canvas, so the shadow does less work here than it does in a list. -->
  <div
    class="rounded-lg border border-line-3 bg-paper-0 px-2.5 py-[9px] text-[12.5px] leading-[1.3] text-ink-4 shadow-card"
  >
    <slot />
  </div>
</template>
