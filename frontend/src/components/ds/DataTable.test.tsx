/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type ColumnDef } from './DataTable';

interface Row { id: string; name: string; trips: number; fare: number; [k: string]: unknown }

const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'trips', header: 'Trips', type: 'numeric', sortable: true },
  { key: 'fare', header: 'Fare', type: 'currency' },
];

// Reverse-alpha order so an ascending name-sort visibly reorders the rows.
const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({
  id: String(i + 1),
  name: `Driver ${String.fromCharCode(74 - i)}`, // J, I, ... A
  trips: i,
  fare: (i + 1) * 10000,
}));

// getAllByRole('row')[0] is the header row; the rest are body rows.
const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('DataTable', () => {
  it('renders all 10 data rows', () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText('Driver J')).toBeInTheDocument();
  });

  it('sorts ascending when a sortable header is clicked', async () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(bodyRows()[0]).toHaveTextContent('Driver J'); // original order
    await userEvent.click(screen.getByText('Name'));
    expect(bodyRows()[0]).toHaveTextContent('Driver A'); // ascending
  });

  it('shows the bulk action bar after select-all', async () => {
    const onDelete = jest.fn();
    render(
      <DataTable columns={columns} data={rows} selectable bulkActions={[{ label: 'Delete', onClick: onDelete }]} />,
    );
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('10 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('triggers CSV export', async () => {
    URL.createObjectURL = jest.fn(() => 'blob:stub');
    URL.revokeObjectURL = jest.fn();
    HTMLAnchorElement.prototype.click = jest.fn();
    render(<DataTable columns={columns} data={rows} exportable />);
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('renders skeleton rows while loading', () => {
    const { container } = render(<DataTable columns={columns} data={[]} loading />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the empty state when there is no data', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('right-aligns the numeric column header', () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(screen.getByText('Trips').closest('th')).toHaveClass('text-right');
  });

  it('formats the currency column as ₹', () => {
    render(<DataTable columns={columns} data={rows} />);
    expect(screen.getByText('₹100')).toBeInTheDocument(); // 10000 paise → ₹100
  });
});
