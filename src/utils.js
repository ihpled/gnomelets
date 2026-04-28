export const UPDATE_INTERVAL_MS = 50; // Update loop runs every 50ms (~20 FPS)
export const GRAVITY = 2;             // Vertical acceleration per frame
export const WALK_SPEED = 3;          // Horizontal pixels per frame

export const State = {
    FALLING: 'FALLING',
    WALKING: 'WALKING',
    IDLE: 'IDLE',
    JUMPING: 'JUMPING',
    DRAGGING: 'DRAGGING'
};

/**
 * Utility to check if a window is maximized or full-screen
 */
export function isWindowMaximized(window) {
    if (!window) return false;
    const isMax = window.maximized_horizontally && window.maximized_vertically;
    const isFull = typeof window.is_fullscreen === 'function' ? window.is_fullscreen() : false;
    return isMax || isFull;
}
