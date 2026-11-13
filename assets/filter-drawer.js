/* Shared modal filter drawer for the project and question workspaces. */
window.aifelFilterDrawer = {
  setup(drawer, opener) {
    const close = drawer.querySelector('.filter-drawer-close');
    opener.addEventListener('click', () => {
      if (!drawer.open) drawer.showModal();
    });
    close.addEventListener('click', () => drawer.close());
    drawer.addEventListener('close', () => opener.focus());
  },
  setupResponsive(button, controls) {
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded));
      controls.classList.toggle('is-open', expanded);
    });
  },
};
