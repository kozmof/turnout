import { AnyValue } from '../value';

type ValueStatus = 'editable' | 'uneditable';

export const createValueStore = (
  initialStore: Record<string, { value: AnyValue; status: ValueStatus }> = {}
) => {
  let store: Record<string, { value: AnyValue; status: ValueStatus }> =
    initialStore;

  const getValue = (key: string) => {
    return key in store ? store[key].value : null;
  };

  const geStatus = (key: string) => {
    return key in store ? store[key].status : null;
  };

  const getEditableKeys = () => {
    return Object.keys(store).filter((key) => store[key].status === 'editable');
  };

  const getUneditableKeys = () => {
    return Object.keys(store).filter(
      (key) => store[key].status === 'uneditable'
    );
  };

  const updateValue = (
    key: string,
    value: AnyValue,
    status: ValueStatus = 'uneditable'
  ) => {
    if (getEditableKeys().includes(key)) {
      store = {
        ...store,
        [key]: { value, status },
      };
    }
  };

  return {
    getValue,
    geStatus,
    updateValue,
    getEditableKeys,
    getUneditableKeys,
  };
};
