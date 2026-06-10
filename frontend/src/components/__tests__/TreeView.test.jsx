/* eslint-disable react/prop-types */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TreeView from '../TreeView';

describe('TreeView component', () => {
    it('renders without crashing', () => {
        const { container } = render(<TreeView data={[]} />);
        expect(container).toBeInTheDocument();
    });
});
