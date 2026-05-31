import '@testing-library/jest-dom';

// jsdom doesn't implement scrollIntoView — stub it so components that call it don't throw
window.HTMLElement.prototype.scrollIntoView = function () {};
