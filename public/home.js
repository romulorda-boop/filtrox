const filterButtons = [...document.querySelectorAll('[data-filter]')];
const searchForm = document.querySelector('#homeSearch');
const searchInput = document.querySelector('#homeSearchInput');

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filterButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  });
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  searchInput.focus();
});
