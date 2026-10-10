// Menu mobilne
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');

menuToggle?.addEventListener('click', () => {
  const isOpen = nav?.classList.toggle('open') ?? false;
  menuToggle.setAttribute('aria-expanded', String(isOpen));
});

document.querySelectorAll('.nav a').forEach(link => {
  link.addEventListener('click', () => {
    nav?.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  });
});

// Animacje pojawiania się sekcji przy przewijaniu
const revealElements = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('show');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  revealElements.forEach(element => observer.observe(element));
} else {
  revealElements.forEach(element => element.classList.add('show'));
}

// Prosty podgląd ulotek: powiększanie, poprzednie/następne, klawiatura i swipe na telefonie
(() => {
  const flyerImages = Array.from(document.querySelectorAll('.flyer-image'));
  if (!flyerImages.length) return;

  const lightbox = document.createElement('div');
  lightbox.className = 'flyer-lightbox';
  lightbox.hidden = true;
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Podgląd ulotek');
  lightbox.innerHTML = `
    <div class="flyer-lightbox__top">
      <div class="flyer-lightbox__heading">
        <p class="flyer-lightbox__eyebrow">Ulotki</p>
        <span class="flyer-lightbox__caption" id="flyer-lightbox-caption">Podgląd ulotki</span>
      </div>
      <div class="flyer-lightbox__top-actions">
        <span class="flyer-lightbox__counter" aria-live="polite">1 / ${flyerImages.length}</span>
        <button class="flyer-lightbox__close" type="button" aria-label="Zamknij podgląd">×</button>
      </div>
    </div>
    <div class="flyer-lightbox__stage">
      <button class="flyer-lightbox__arrow flyer-lightbox__arrow--prev" type="button" aria-label="Poprzednia ulotka">‹</button>
      <img class="flyer-lightbox__image" alt="" draggable="false">
      <button class="flyer-lightbox__arrow flyer-lightbox__arrow--next" type="button" aria-label="Następna ulotka">›</button>
    </div>
    <div class="flyer-lightbox__bottom">Użyj strzałek, aby przechodzić między zdjęciami</div>
  `;
  document.body.appendChild(lightbox);

  const largeImage = lightbox.querySelector('.flyer-lightbox__image');
  const caption = lightbox.querySelector('.flyer-lightbox__caption');
  const counter = lightbox.querySelector('.flyer-lightbox__counter');
  const closeButton = lightbox.querySelector('.flyer-lightbox__close');
  const previousButton = lightbox.querySelector('.flyer-lightbox__arrow--prev');
  const nextButton = lightbox.querySelector('.flyer-lightbox__arrow--next');
  const stage = lightbox.querySelector('.flyer-lightbox__stage');

  let currentIndex = 0;
  let activeBeforeOpen = null;
  let closeTimer = null;
  let touchStart = null;

  const getImageLabel = (image, index) => {
    const alt = (image.getAttribute('alt') || '').trim();
    return alt || `Ulotka ${index + 1}`;
  };

  const showImage = index => {
    currentIndex = (index + flyerImages.length) % flyerImages.length;
    const selectedImage = flyerImages[currentIndex];
    largeImage.src = selectedImage.currentSrc || selectedImage.src;
    largeImage.alt = getImageLabel(selectedImage, currentIndex);
    caption.textContent = getImageLabel(selectedImage, currentIndex);
    counter.textContent = `${String(currentIndex + 1).padStart(2, '0')} / ${String(flyerImages.length).padStart(2, '0')}`;
    previousButton.disabled = flyerImages.length < 2;
    nextButton.disabled = flyerImages.length < 2;
  };

  const openLightbox = index => {
    window.clearTimeout(closeTimer);
    activeBeforeOpen = document.activeElement;
    showImage(index);
    lightbox.hidden = false;
    document.body.classList.add('flyer-lightbox-open');
    // Dwie klatki pozwalają przeglądarce zastosować animację wejścia.
    requestAnimationFrame(() => {
      lightbox.classList.add('is-visible');
      closeButton.focus({ preventScroll: true });
    });
  };

  const closeLightbox = () => {
    if (lightbox.hidden) return;
    lightbox.classList.remove('is-visible');
    document.body.classList.remove('flyer-lightbox-open');
    closeTimer = window.setTimeout(() => {
      lightbox.hidden = true;
      if (activeBeforeOpen && typeof activeBeforeOpen.focus === 'function') {
        activeBeforeOpen.focus({ preventScroll: true });
      }
    }, 210);
  };

  flyerImages.forEach((image, index) => {
    const card = image.closest('.flyer-card') || image;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Powiększ: ${getImageLabel(image, index)}`);
    card.addEventListener('click', () => openLightbox(index));
    card.addEventListener('keydown', event => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(index);
      }
    });
  });

  closeButton.addEventListener('click', closeLightbox);
  previousButton.addEventListener('click', () => showImage(currentIndex - 1));
  nextButton.addEventListener('click', () => showImage(currentIndex + 1));

  lightbox.addEventListener('click', event => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', event => {
    if (lightbox.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLightbox();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showImage(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showImage(currentIndex + 1);
    }
  });

  stage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') {
      touchStart = { x: event.clientX, y: event.clientY };
    }
  });
  stage.addEventListener('pointerup', event => {
    if (!touchStart || event.pointerType !== 'touch') return;
    const deltaX = event.clientX - touchStart.x;
    const deltaY = event.clientY - touchStart.y;
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      showImage(currentIndex + (deltaX < 0 ? 1 : -1));
    }
    touchStart = null;
  });
  stage.addEventListener('pointercancel', () => { touchStart = null; });
})();
