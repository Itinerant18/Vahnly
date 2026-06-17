import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';

interface DriverItem {
  id: string;
  name: string;
  phone: string;
  current_state: string;
  city_prefix: string;
}

// Driver pool entry as returned by GET /admin/drivers.
interface DriverSummaryResponse {
  driver_id: string;
  name: string;
  phone: string;
  city_prefix: string;
  status: string;
}

export const ManualBooking: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);

  // Step 1: Rider
  const [customerId, setCustomerId] = useState<string>('');
  const [riderPhone, setRiderPhone] = useState<string>('');

  // Step 2: Car
  const [carMode, setCarMode] = useState<'garage' | 'onetime'>('garage');
  const [carModel, setCarModel] = useState<string>('Maruti Swift');
  const [carPlate, setCarPlate] = useState<string>('WB-02-AB-1234');
  const [carType, setCarType] = useState<string>('Hatchback');
  const [transmission, setTransmission] = useState<string>('Manual');

  // Step 3: Config
  const [cityPrefix, setCityPrefix] = useState<string>('KOL');
  const [tripType, setTripType] = useState<string>('one-way');
  const [pickupAddress, setPickupAddress] = useState<string>('Salt Lake Sector V, Kolkata');
  const [dropoffAddress, setDropoffAddress] = useState<string>('Howrah Junction, Kolkata');
  // Simulated Coordinates
  const [pickupLat] = useState<number>(22.5726);
  const [pickupLng] = useState<number>(88.3639);
  const [dropoffLat] = useState<number>(22.5855);
  const [dropoffLng] = useState<number>(88.4111);

  // Step 4: Schedule
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState<string>('');

  // Step 5: Fare
  const [baseFareINR, setBaseFareINR] = useState<number>(350);

  // Step 6: Driver
  const [availableDrivers, setAvailableDrivers] = useState<DriverItem[]>([]);
  const [driversLoading, setDriversLoading] = useState<boolean>(false);
  const [assignedDriverId, setAssignedDriverId] = useState<string>('');

  // Fetch the online/active driver pool from GET /admin/drivers (NOT the KYC pending queue).
  const fetchDrivers = async () => {
    setDriversLoading(true);
    try {
      const role = localStorage.getItem('admin_role') || 'ADMIN';

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers?status=ACTIVE`, {
        headers: {
          'X-Admin-Role': role,
        },
      });

      if (res.ok) {
        const data: DriverSummaryResponse[] = await res.json();
        const list = (data || []).map((d) => ({
          id: d.driver_id,
          name: d.name || 'Driver',
          phone: d.phone || '—',
          current_state: d.status || 'ACTIVE',
          city_prefix: d.city_prefix || 'KOL',
        }));
        setAvailableDrivers(list);
      } else {
        setAvailableDrivers([]);
      }
    } catch (err) {
      console.error(err);
      setAvailableDrivers([]);
    } finally {
      setDriversLoading(false);
    }
  };

  useEffect(() => {
    if (step === 6) {
      fetchDrivers();
    }
  }, [step]);

  const handleGenerateRider = () => {
    // Generate a random UUID
    const randomUuid = 'c0f1e000-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    setCustomerId(randomUuid);
    setRiderPhone('+91 ' + Math.floor(6000000000 + Math.random() * 4000000000));
  };

  const handleConfirmBooking = async () => {
    setLoading(true);
    try {
      const role = localStorage.getItem('admin_role') || 'ADMIN';

      // Send the full booking payload. The order service ignores fields it does not
      // persist yet, but the contract carries the complete admin-entered context.
      const bookingPayload = {
        customer_id: customerId,
        rider_phone: riderPhone,
        city_prefix: cityPrefix,
        trip_type: tripType,
        transmission,
        car_model: carModel,
        car_plate: carPlate,
        car_type: carType,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        dropoff_lat: dropoffLat,
        dropoff_lng: dropoffLng,
        base_fare_paise: Math.round(baseFareINR * 100),
        scheduled_at: scheduleMode === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        assigned_driver_id: assignedDriverId || undefined,
      };

      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Role': role,
        },
        body: JSON.stringify(bookingPayload),
      });

      if (res.ok) {
        const data = await res.json();
        alert('Booking created successfully!');
        if (data.order_id) {
          navigate(`/trips/${data.order_id}`);
        } else {
          navigate('/trips');
        }
      } else {
        const errText = await res.text();
        alert(`Failed to create manual booking: ${errText}`);
      }
    } catch (err) {
      console.error(err);
      alert('Network request execution failure.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center space-x-2 border-b border-background-secondary pb-4">
        <Link to="/trips" className="text-xs text-content-tertiary hover:text-content-primary font-medium">Trips</Link>
        <span className="text-xs text-content-tertiary font-mono">/</span>
        <span className="text-xs text-content-primary font-semibold">New Booking</span>
      </div>

      <div className="max-w-xl mx-auto bg-background-primary rounded-xl border border-background-secondary overflow-hidden shadow-sm">
        {/* Step Indicator Header */}
        <div className="bg-background-secondary border-b border-background-secondary px-5 py-3 flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-content-tertiary font-mono">
          <span>Step {step} of 7</span>
          <span>
            {step === 1 && 'Rider Details'}
            {step === 2 && 'Car Selection'}
            {step === 3 && 'Config & Address'}
            {step === 4 && 'Schedule'}
            {step === 5 && 'Fare Estimate'}
            {step === 6 && 'Driver Assignment'}
            {step === 7 && 'Confirm Booking'}
          </span>
        </div>

        <div className="p-6 space-y-6">

          {/* STEP 1: Rider */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-content-primary">Search or Register Rider</h3>
                <p className="text-xs text-content-tertiary mt-1">Designate a customer UUID associated with this manual booking</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Customer UUID</label>
                  <input
                    type="text"
                    placeholder="Enter customer UUID..."
                    className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Rider Phone</label>
                  <input
                    type="text"
                    placeholder="Enter phone number..."
                    className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono"
                    value={riderPhone}
                    onChange={(e) => setRiderPhone(e.target.value)}
                  />
                </div>
                <div className="flex items-center space-x-2 pt-2">
                  <span className="text-xs text-content-tertiary">or</span>
                  <button
                    onClick={handleGenerateRider}
                    className="text-xs text-content-primary font-semibold hover:underline"
                  >
                    Generate Random Profile
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Vehicle */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-content-primary">Choose Vehicle Details</h3>
                <p className="text-xs text-content-tertiary mt-1">Select a car from the dispatch fleet or enter custom plates</p>
              </div>
              <div className="flex space-x-2 bg-background-secondary p-1 rounded-pill border border-background-secondary mb-2">
                <button
                  onClick={() => setCarMode('garage')}
                  className={`flex-1 text-xs font-semibold h-8 rounded-pill transition-colors ${
                    carMode === 'garage' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                  }`}
                >
                  Select from Garage
                </button>
                <button
                  onClick={() => setCarMode('onetime')}
                  className={`flex-1 text-xs font-semibold h-8 rounded-pill transition-colors ${
                    carMode === 'onetime' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                  }`}
                >
                  One-time Custom Entry
                </button>
              </div>

              {carMode === 'garage' ? (
                <div className="space-y-2">
                  {[
                    { model: 'Maruti Swift', plate: 'WB-02-AB-1234', type: 'Hatchback' },
                    { model: 'Honda City', plate: 'WB-02-CD-5678', type: 'Sedan' },
                    { model: 'Toyota Innova', plate: 'WB-02-EF-9011', type: 'SUV' },
                    { model: 'Audi A6 Premium', plate: 'WB-02-GH-2211', type: 'Premium' },
                  ].map((v) => (
                    <button
                      key={v.plate}
                      onClick={() => {
                        setCarModel(v.model);
                        setCarPlate(v.plate);
                        setCarType(v.type);
                      }}
                      className={`w-full text-left p-3 rounded-xl border flex justify-between items-center text-xs transition-colors ${
                        carPlate === v.plate
                          ? 'border-content-primary bg-background-tertiary'
                          : 'border-background-secondary hover:bg-background-tertiary/50'
                      }`}
                    >
                      <div>
                        <span className="font-bold text-content-primary block">{v.model}</span>
                        <span className="text-[10px] text-content-tertiary font-mono">{v.plate}</span>
                      </div>
                      <span className="bg-background-secondary border border-background-secondary px-2.5 py-0.5 rounded-pill font-mono font-semibold">{v.type}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Make / Model</label>
                    <input
                      type="text"
                      className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary"
                      value={carModel}
                      onChange={(e) => setCarModel(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">License Plate</label>
                    <input
                      type="text"
                      className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary font-mono uppercase"
                      value={carPlate}
                      onChange={(e) => setCarPlate(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Car Class</label>
                    <select
                      className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
                      value={carType}
                      onChange={(e) => setCarType(e.target.value)}
                    >
                      <option value="Hatchback">Hatchback</option>
                      <option value="Sedan">Sedan</option>
                      <option value="SUV">SUV</option>
                      <option value="Premium">Premium</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Transmission</label>
                <div className="flex space-x-2 bg-background-secondary p-0.5 rounded-pill border border-background-secondary">
                  {['Manual', 'Automatic'].map((t) => (
                    <button
                      key={t}
                      onClick={() => setTransmission(t)}
                      className={`flex-1 text-[11px] font-semibold h-7 rounded-pill transition-colors ${
                        transmission === t ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Config */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-content-primary">Trip Scoping & Addresses</h3>
                <p className="text-xs text-content-tertiary mt-1">Specify destination route details</p>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">City Hub</label>
                    <select
                      className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
                      value={cityPrefix}
                      onChange={(e) => setCityPrefix(e.target.value)}
                    >
                      <option value="KOL">KOL (Kolkata)</option>
                      <option value="BLR">BLR (Bangalore)</option>
                      <option value="DEL">DEL (Delhi)</option>
                      <option value="MUM">MUM (Mumbai)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Trip Type</label>
                    <select
                      className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary"
                      value={tripType}
                      onChange={(e) => setTripType(e.target.value)}
                    >
                      <option value="one-way">One-Way</option>
                      <option value="in-city round">In-City Round</option>
                      <option value="mini-outstation">Mini-Outstation</option>
                      <option value="outstation">Outstation</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Pickup Address</label>
                  <input
                    type="text"
                    className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary"
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Dropoff Address</label>
                  <input
                    type="text"
                    className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-none focus:border-content-primary"
                    value={dropoffAddress}
                    onChange={(e) => setDropoffAddress(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Schedule */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-content-primary">Schedule Booking</h3>
                <p className="text-xs text-content-tertiary mt-1">Dispatch immediately or schedule for a future date and time</p>
              </div>
              <div className="flex space-x-2 bg-background-secondary p-1 rounded-pill border border-background-secondary">
                <button
                  onClick={() => setScheduleMode('now')}
                  className={`flex-1 text-xs font-semibold h-8 rounded-pill transition-colors ${
                    scheduleMode === 'now' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                  }`}
                >
                  Dispatch Now
                </button>
                <button
                  onClick={() => setScheduleMode('later')}
                  className={`flex-1 text-xs font-semibold h-8 rounded-pill transition-colors ${
                    scheduleMode === 'later' ? 'bg-content-primary text-gray-0' : 'text-content-secondary hover:bg-background-tertiary/50'
                  }`}
                >
                  Schedule for Later
                </button>
              </div>
              {scheduleMode === 'later' && (
                <div>
                  <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Pickup Date & Time</label>
                  <input
                    type="datetime-local"
                    className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* STEP 5: Fare Quote */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-content-primary">Fare Quote Estimator</h3>
                <p className="text-xs text-content-tertiary mt-1">Review the estimated fare or apply overrides for manual bookings</p>
              </div>
              <div className="bg-background-secondary rounded-xl p-5 border border-background-secondary space-y-4 text-center">
                <div className="text-[10px] uppercase tracking-wider text-content-tertiary font-mono">Calculated Fare Quote</div>
                <div className="text-4xl font-bold font-mono text-content-primary">₹{baseFareINR}</div>
                <p className="text-xs text-content-tertiary">Distance: 12.4 km · Traffic Index: Normal</p>
              </div>
              <div>
                <label className="block text-[10px] uppercase text-content-tertiary font-semibold mb-1">Custom Fare Override (INR)</label>
                <input
                  type="number"
                  className="w-full h-9 rounded-pill bg-background-secondary border border-background-secondary px-3 text-xs text-content-primary focus:outline-none focus:border-content-primary font-mono text-center"
                  value={baseFareINR}
                  onChange={(e) => setBaseFareINR(Number(e.target.value))}
                />
              </div>
            </div>
          )}

          {/* STEP 6: Driver */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-content-primary">Assign Driver</h3>
                <p className="text-xs text-content-tertiary mt-1">Select from currently active drivers or leave empty for auto-matching</p>
              </div>
              {driversLoading ? (
                <div className="p-12 text-center text-xs text-content-tertiary animate-pulse">Scanning available drivers...</div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  <button
                    onClick={() => setAssignedDriverId('')}
                    className={`w-full text-left p-3 rounded-xl border flex justify-between items-center text-xs transition-colors ${
                      assignedDriverId === ''
                        ? 'border-content-primary bg-background-tertiary font-bold'
                        : 'border-background-secondary hover:bg-background-tertiary/50'
                    }`}
                  >
                    <span>Auto-Dispatch (Engine Match)</span>
                    <span className="text-[10px] text-content-tertiary font-mono">system assignment</span>
                  </button>
                  {availableDrivers.length === 0 && (
                    <div className="p-4 text-center text-[11px] text-content-tertiary">No active drivers found — auto-dispatch will be used.</div>
                  )}
                  {availableDrivers.map((drv) => (
                    <button
                      key={drv.id}
                      onClick={() => setAssignedDriverId(drv.id)}
                      className={`w-full text-left p-3 rounded-xl border flex justify-between items-center text-xs transition-colors ${
                        assignedDriverId === drv.id
                          ? 'border-content-primary bg-background-tertiary font-bold'
                          : 'border-background-secondary hover:bg-background-tertiary/50'
                      }`}
                    >
                      <div>
                        <span className="block text-content-primary">{drv.name}</span>
                        <span className="block text-[10px] text-content-tertiary font-mono">{drv.phone}</span>
                      </div>
                      <span className="text-[10px] font-mono text-content-tertiary truncate max-w-[120px]">{drv.city_prefix}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 7: Confirm */}
          {step === 7 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-content-primary">Confirm Booking Parameters</h3>
                <p className="text-xs text-content-tertiary mt-1">Audit the finalized parameters before executing insertion</p>
              </div>
              <div className="bg-background-secondary border border-background-secondary rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Rider UUID:</span>
                  <span className="font-mono text-content-primary font-semibold truncate max-w-[200px]">{customerId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Rider Phone:</span>
                  <span className="font-mono text-content-primary font-semibold">{riderPhone || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Vehicle Selected:</span>
                  <span className="text-content-primary font-semibold">{carModel} ({carPlate})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Transmission:</span>
                  <span className="text-content-primary font-semibold">{transmission}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Route:</span>
                  <span className="text-content-primary font-semibold text-right truncate max-w-[220px]">{pickupAddress} → {dropoffAddress}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">City prefix:</span>
                  <span className="text-content-primary font-semibold font-mono">{cityPrefix}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Type of Trip:</span>
                  <span className="text-content-primary font-semibold capitalize">{tripType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Schedule:</span>
                  <span className="text-content-primary font-semibold">
                    {scheduleMode === 'later' && scheduledAt ? new Date(scheduledAt).toLocaleString() : 'Immediate'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Base Fare:</span>
                  <span className="text-content-primary font-semibold font-mono">₹{baseFareINR.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Assigned Driver:</span>
                  <span className="text-content-primary font-semibold font-mono">
                    {assignedDriverId ? assignedDriverId : 'Auto-dispatch pool'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="flex justify-between border-t border-background-secondary pt-4">
            <button
              onClick={() => step > 1 && setStep(step - 1)}
              disabled={step === 1}
              className="text-xs text-content-secondary hover:text-content-primary font-semibold px-3 disabled:opacity-40 h-9"
            >
              Back
            </button>
            {step < 7 ? (
              <button
                onClick={() => {
                  if (step === 1 && !customerId.trim()) {
                    alert('Please enter or generate a rider UUID.');
                    return;
                  }
                  if (step === 4 && scheduleMode === 'later' && !scheduledAt) {
                    alert('Please pick a scheduled date and time.');
                    return;
                  }
                  setStep(step + 1);
                }}
                className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-5 hover:bg-gray-800 transition-colors"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={handleConfirmBooking}
                disabled={loading}
                className="bg-content-primary text-gray-0 text-xs font-semibold rounded-pill h-9 px-5 hover:bg-gray-800 transition-colors"
              >
                {loading ? 'Creating Ride...' : 'Confirm & Dispatch'}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
