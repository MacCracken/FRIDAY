// Smooth scrolling functionality
function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId);
  if (element) {
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }
}

// Add animation on scroll
function handleScrollAnimation() {
  const elements = document.querySelectorAll('.feature-card, .yeoman-card, .step, .arch-layer');

  elements.forEach((element) => {
    const elementTop = element.getBoundingClientRect().top;
    const elementBottom = element.getBoundingClientRect().bottom;
    const windowHeight = window.innerHeight;

    if (elementTop < windowHeight * 0.8 && elementBottom > 0) {
      element.style.opacity = '1';
      element.style.transform = 'translateY(0)';
    }
  });
}

// Initialize scroll animations
function initScrollAnimations() {
  const elements = document.querySelectorAll('.feature-card, .yeoman-card, .step, .arch-layer');

  elements.forEach((element) => {
    element.style.opacity = '0';
    element.style.transform = 'translateY(30px)';
    element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  });

  // Trigger initial check
  handleScrollAnimation();
}

// Add parallax effect to background circuits
function handleParallax() {
  const scrolled = window.pageYOffset;
  const circuits = document.querySelectorAll('.floating-circuit');

  circuits.forEach((circuit, index) => {
    const speed = 0.5 + index * 0.1;
    const yPos = -(scrolled * speed);
    circuit.style.transform = `translateY(${yPos}px)`;
  });
}

// Terminal typing effect for code blocks
function typeWriter(element, text, speed = 50) {
  let i = 0;
  element.textContent = '';

  function type() {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
      setTimeout(type, speed);
    }
  }

  type();
}

// Interactive demo functionality
function initDemoMode() {
  const featureCards = document.querySelectorAll('.feature-card');

  featureCards.forEach((card) => {
    card.addEventListener('mouseenter', function () {
      // Add glow effect
      this.style.boxShadow = '0 15px 40px rgba(37, 99, 235, 0.3)';
    });

    card.addEventListener('mouseleave', function () {
      // Remove glow effect
      this.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.3)';
    });
  });
}

// Copy to clipboard functionality for code blocks
function initCopyToClipboard() {
  const codeBlocks = document.querySelectorAll('.code-block');

  codeBlocks.forEach((block) => {
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.className = 'copy-btn';
    copyBtn.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: var(--primary-color);
            color: white;
            border: none;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

    block.style.position = 'relative';
    block.appendChild(copyBtn);

    block.addEventListener('mouseenter', () => {
      copyBtn.style.opacity = '1';
    });

    block.addEventListener('mouseleave', () => {
      copyBtn.style.opacity = '0';
    });

    copyBtn.addEventListener('click', () => {
      const text = block.textContent.replace('Copy', '').trim();
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      });
    });
  });
}

// Add keyboard navigation
function initKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Press 'F' to scroll to features
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
      scrollToSection('features');
    }

    // Press 'G' to scroll to getting started
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
      scrollToSection('getting-started');
    }

    // Press 'Home' to go to top
    if (e.key === 'Home') {
      e.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }
  });
}

// Add loading animation
function addLoadingAnimation() {
  const logoLetters = document.querySelectorAll('.logo-letter');

  logoLetters.forEach((letter, index) => {
    letter.style.animationDelay = `${index * 0.1}s`;
  });
}

// Add particle effects for hero section
function createParticles() {
  const heroSection = document.querySelector('.hero');
  const particleCount = 20;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.cssText = `
            position: absolute;
            width: ${Math.random() * 4 + 1}px;
            height: ${Math.random() * 4 + 1}px;
            background: var(--primary-color);
            border-radius: 50%;
            top: ${Math.random() * 100}%;
            left: ${Math.random() * 100}%;
            opacity: ${Math.random() * 0.5 + 0.1};
            animation: particleFloat ${Math.random() * 10 + 10}s infinite linear;
        `;

    heroSection.appendChild(particle);
  }

  // Add particle animation
  const style = document.createElement('style');
  style.textContent = `
        @keyframes particleFloat {
            0% {
                transform: translateY(0px) translateX(0px);
                opacity: 0;
            }
            10% {
                opacity: 1;
            }
            90% {
                opacity: 1;
            }
            100% {
                transform: translateY(-100vh) translateX(${Math.random() * 200 - 100}px);
                opacity: 0;
            }
        }
    `;
  document.head.appendChild(style);
}

// Add smooth reveal for sections
function initSectionReveal() {
  const sections = document.querySelectorAll('section');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
        }
      });
    },
    {
      threshold: 0.1,
    }
  );

  sections.forEach((section) => {
    section.style.opacity = '0';
    section.style.transform = 'translateY(50px)';
    section.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
    observer.observe(section);
  });

  // Add revealed class styling
  const style = document.createElement('style');
  style.textContent = `
        section.revealed {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
  document.head.appendChild(style);
}

// Add responsive navigation (for future mobile menu)
function initResponsiveNav() {
  const logoSection = document.querySelector('.logo-section');

  // Add click interaction to logo
  logoSection.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  });

  logoSection.style.cursor = 'pointer';
}

// Add performance monitoring
function initPerformanceMonitoring() {
  // Track page load performance
  window.addEventListener('load', () => {
    const loadTime = performance.now();
    console.log(`Page loaded in ${loadTime.toFixed(2)}ms`);
  });

  // Track scroll performance
  let ticking = false;
  function updateOnScroll() {
    handleScrollAnimation();
    handleParallax();
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateOnScroll);
      ticking = true;
    }
  });
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initScrollAnimations();
  initDemoMode();
  initCopyToClipboard();
  initKeyboardNavigation();
  addLoadingAnimation();
  createParticles();
  initSectionReveal();
  initResponsiveNav();
  initPerformanceMonitoring();

  // Add entrance animation to hero section
  setTimeout(() => {
    document.querySelector('.hero').style.opacity = '1';
    document.querySelector('.hero').style.transform = 'translateY(0)';
  }, 100);
});

// Add hover effects for buttons
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('.btn-primary, .btn-secondary');

  buttons.forEach((button) => {
    button.addEventListener('mouseenter', function () {
      this.style.transform = 'translateY(-2px) scale(1.05)';
    });

    button.addEventListener('mouseleave', function () {
      this.style.transform = 'translateY(0) scale(1)';
    });

    button.addEventListener('click', function (e) {
      // Create ripple effect
      const ripple = document.createElement('span');
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      ripple.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.5);
                left: ${x}px;
                top: ${y}px;
                animation: ripple 0.6s ease-out;
                pointer-events: none;
            `;

      this.style.position = 'relative';
      this.style.overflow = 'hidden';
      this.appendChild(ripple);

      setTimeout(() => ripple.remove(), 600);
    });
  });

  // Add ripple animation
  const style = document.createElement('style');
  style.textContent = `
        @keyframes ripple {
            from {
                transform: scale(0);
                opacity: 1;
            }
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
    `;
  document.head.appendChild(style);
});

// Add dynamic year to footer
document.addEventListener('DOMContentLoaded', () => {
  const yearElement = document.querySelector('.footer-info p');
  if (yearElement) {
    const currentYear = new Date().getFullYear();
    yearElement.innerHTML = yearElement.innerHTML.replace('2024', currentYear);
  }
});
