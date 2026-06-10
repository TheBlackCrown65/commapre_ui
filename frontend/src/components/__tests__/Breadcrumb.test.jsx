/* eslint-disable react/prop-types */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Breadcrumb from '../Breadcrumb';

describe('Breadcrumb component', () => {
    it('renders nothing when items array is empty', () => {
        const { container } = render(<Breadcrumb items={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders Root button and items', () => {
        const items = [
            { id: 1, name: 'Folder 1', type: 'folder' },
            { id: 2, name: 'Flow 1', type: 'flow' }
        ];
        render(<Breadcrumb items={items} />);
        
        expect(screen.getByText('Root')).toBeInTheDocument();
        expect(screen.getByText('Folder 1')).toBeInTheDocument();
        expect(screen.getByText('Flow 1')).toBeInTheDocument();
    });

    it('calls onNavigate with correct item when clicked', () => {
        const handleNavigate = vi.fn();
        const items = [
            { id: 1, name: 'Folder 1', type: 'folder' }
        ];
        render(<Breadcrumb items={items} onNavigate={handleNavigate} />);
        
        fireEvent.click(screen.getByText('Folder 1'));
        expect(handleNavigate).toHaveBeenCalledWith(items[0]);
        
        fireEvent.click(screen.getByText('Root'));
        expect(handleNavigate).toHaveBeenCalledWith(null);
    });
});
