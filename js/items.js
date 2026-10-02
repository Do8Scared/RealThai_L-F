import { supabase } from './supabase-config.js';
import { toast, DEMO_ITEMS } from './utils.js';

const COLLECTION_NAME = 'items';

function normalizeItem(item) {
    const createdAt = item.created_at || item.createdAt || { seconds: Math.floor(Date.now() / 1000) };
    return {
        ...item,
        id: item.id,
        createdAt: createdAt && createdAt.toDate ? createdAt : { seconds: new Date(createdAt).getTime() / 1000 }
    };
}

export function subscribeToItems(callback, onError = null) {
    if (!supabase) {
        callback(DEMO_ITEMS);
        if (onError) onError(new Error('Supabase unavailable; using demo data.'));
        return () => {};
    }

    const loadItems = async () => {
        try {
            const { data, error } = await supabase
                .from(COLLECTION_NAME)
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                throw error;
            }

            callback((data || []).map(normalizeItem));
        } catch (error) {
            console.warn('Supabase unavailable; falling back to demo data.', error);
            callback(DEMO_ITEMS);
            if (onError) onError(error);
        }
    };

    loadItems();

    try {
        const channel = supabase
            .channel('items_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: COLLECTION_NAME }, () => {
                loadItems();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    } catch (error) {
        console.warn('Supabase realtime unavailable; demo mode remains active.', error);
        return () => {};
    }
}

// upload item image to Supabase storage if configured
export async function uploadItemImage(file, isDemo) {
    if (!file) return '';
    if (isDemo) {
        return URL.createObjectURL(file);
    }

    try {
        if (!supabase || !supabase.storage) {
            throw new Error('Supabase storage is not configured');
        }

        const filePath = `items/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
        const { data, error } = await supabase.storage.from('items').upload(filePath, file);

        if (error) throw error;
        const { publicUrl } = supabase.storage.from('items').getPublicUrl(data.path);
        return publicUrl;
    } catch (error) {
        console.error('Image upload failed:', error);
        toast('Image upload failed. Please try again.', 'error');
        return '';
    }
}

// Submit new report
export async function submitItemReport(payload, isDemo) {
    if (isDemo) {
        return { id: 'd' + Date.now(), ...payload, createdAt: { seconds: Math.floor(Date.now() / 1000) } };
    }

    if (!supabase) {
        throw new Error('Supabase is not initialized');
    }

    const itemToInsert = {
        ...payload,
        created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from(COLLECTION_NAME)
        .insert(itemToInsert)
        .select();

    if (error) {
        throw error;
    }

    return normalizeItem((data && data[0]) || itemToInsert);
}

// Update existing report item status
export async function updateItemStatus(id, status, isDemo) {
    if (isDemo) return true;
    if (!supabase) return false;

    const { error } = await supabase
        .from(COLLECTION_NAME)
        .update({ status })
        .eq('id', id);

    return !error;
}

// Delete a report item
export async function deleteItemReport(id, isDemo) {
    if (isDemo) return true;
    if (!supabase) return false;

    const { error } = await supabase
        .from(COLLECTION_NAME)
        .delete()
        .eq('id', id);

    return !error;
}
